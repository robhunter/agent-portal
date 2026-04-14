"""
mitmproxy addon: network access rules and secret substitution.

Loaded via: mitmweb -s /scripts/mitmproxy_addon.py

On startup, reads settings from up to three layers (lowest to highest
precedence): user (~/.config/sandcat/settings.json), project
(.sandcat/settings.json), and local (.sandcat/settings.local.json).
Env vars and secrets are merged (higher precedence wins on conflict).
Network rules are concatenated (highest precedence first).

Network rules are evaluated top-to-bottom, first match wins, default deny.
Secret placeholders are replaced with real values only for allowed hosts.
"""

import base64
import json
import logging
import os
from fnmatch import fnmatch

from mitmproxy import ctx, http, dns

# Settings layers, lowest to highest precedence.
SETTINGS_PATHS = [
    "/config/settings.json",                # user:    ~/.config/sandcat/settings.json
    "/config/project/settings.json",        # project: .sandcat/settings.json
    "/config/project/settings.local.json",  # local:   .sandcat/settings.local.json
]
SANDCAT_ENV_PATH = "/home/mitmproxy/.mitmproxy/sandcat.env"

logger = logging.getLogger(__name__)

class SandcatAddon:
    def __init__(self):
        self.secrets: dict[str, dict] = {}  # name -> {value, hosts, placeholder}
        self.network_rules: list[dict] = []
        self.env: dict[str, str] = {}  # non-secret env vars

    def load(self, loader):
        layers = []
        for path in SETTINGS_PATHS:
            if os.path.isfile(path):
                try:
                    with open(path) as f:
                        layers.append(json.load(f))
                except (json.JSONDecodeError, OSError) as e:
                    ctx.log.error(f"Failed to load {path}: {e}")
                    raise

        if not layers:
            logger.info("No settings files found — addon disabled")
            return

        merged = self._merge_settings(layers)

        self.env = merged["env"]
        self._load_secrets(merged["secrets"])
        self._load_network_rules(merged["network"])
        self._write_placeholders_env()

        ctx.log.info(
            f"Loaded {len(self.env)} env var(s) and {len(self.secrets)} secret(s), wrote {SANDCAT_ENV_PATH}"
        )

    @staticmethod
    def _merge_settings(layers: list[dict]) -> dict:
        """Merge settings from multiple layers (lowest to highest precedence).

        - env: dict merge, higher precedence overwrites.
        - secrets: dict merge, higher precedence overwrites.
        - network: concatenated, highest precedence first.
        """
        env: dict[str, str] = {}
        secrets: dict[str, dict] = {}
        network: list[dict] = []

        for layer in layers:
            env.update(layer.get("env", {}))
            secrets.update(layer.get("secrets", {}))

        # Network rules: highest-precedence layer's rules come first.
        for layer in reversed(layers):
            network.extend(layer.get("network", []))

        return {"env": env, "secrets": secrets, "network": network}

    def _load_secrets(self, raw_secrets: dict):
        for name, entry in raw_secrets.items():
            placeholder = f"SANDCAT_PLACEHOLDER_{name}"
            self.secrets[name] = {
                "value": entry["value"],
                "hosts": entry.get("hosts", []),
                "placeholder": placeholder,
            }

    def _load_network_rules(self, raw_rules: list):
        self.network_rules = raw_rules
        ctx.log.info(f"Loaded {len(self.network_rules)} network rule(s)")

    @staticmethod
    def _shell_escape(value: str) -> str:
        """Escape a string for safe inclusion inside double quotes in shell."""
        return value.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$").replace("`", "\\`")

    def _write_placeholders_env(self):
        lines = []
        # Non-secret env vars (e.g. git identity) — passed through as-is.
        for name, value in self.env.items():
            lines.append(f'export {name}="{self._shell_escape(value)}"')
        for name, entry in self.secrets.items():
            lines.append(f'export {name}="{self._shell_escape(entry["placeholder"])}"')
        with open(SANDCAT_ENV_PATH, "w") as f:
            f.write("\n".join(lines) + "\n")

    def _is_request_allowed(self, method: str | None, host: str) -> bool:
        for rule in self.network_rules:
            if not fnmatch(host, rule["host"]):
                continue
            rule_method = rule.get("method")
            if rule_method is not None and method is not None and rule_method.upper() != method.upper():
                continue
            return rule["action"] == "allow"
        return False # default deny

    def _substitute_secrets(self, flow: http.HTTPFlow):
        host = flow.request.pretty_host

        for name, entry in self.secrets.items():
            placeholder = entry["placeholder"]
            value = entry["value"]
            allowed_hosts = entry["hosts"]

            placeholder_bytes = placeholder.encode()

            present = (
                placeholder in flow.request.url
                or any(placeholder_bytes in v for _, v in flow.request.headers.fields)
                or (
                    flow.request.content
                    and placeholder_bytes in flow.request.content
                )
            )

            # Also check inside Base64-encoded Basic auth headers.
            # Tools like git encode credentials as Basic base64(user:pass),
            # hiding the placeholder from a raw byte scan.
            basic_auth_match = False
            if not present:
                for k, v in flow.request.headers.fields:
                    if k.lower() != b"authorization":
                        continue
                    if not v.startswith(b"Basic "):
                        continue
                    try:
                        decoded = base64.b64decode(v[6:]).decode("utf-8", errors="replace")
                    except Exception:
                        continue
                    if placeholder in decoded:
                        present = True
                        basic_auth_match = True
                        break

            if not present:
                continue

            # Skip substitution if secret is not allowed for this host.
            # The placeholder (not the real value) stays in the request,
            # which is harmless — e.g. it may appear in LLM prompt context.
            if not any(fnmatch(host, pattern) for pattern in allowed_hosts):
                ctx.log.debug(
                    f"Skipping secret {name!r} substitution for host {host!r} (not in allowed hosts)"
                )
                continue

            value_bytes = value.encode()

            if placeholder in flow.request.url:
                # Substitute in .path (which includes query string) rather than
                # .url to avoid the url setter triggering host= which calls
                # _update_host_and_authority() and overwrites the Host header
                # with the raw IP in transparent/wireguard mode.
                flow.request.path = flow.request.path.replace(placeholder, value)
            # Use .fields (raw byte tuples) to preserve multi-valued headers.
            # headers[k] = v would collapse duplicate header names.
            if basic_auth_match:
                # Decode Basic auth, substitute placeholder, re-encode.
                def _sub_basic(k: bytes, v: bytes) -> tuple[bytes, bytes]:
                    if k.lower() != b"authorization" or not v.startswith(b"Basic "):
                        return (k, v)
                    try:
                        decoded = base64.b64decode(v[6:])
                        if placeholder_bytes not in decoded:
                            return (k, v)
                        replaced = decoded.replace(placeholder_bytes, value_bytes)
                        return (k, b"Basic " + base64.b64encode(replaced))
                    except Exception:
                        return (k, v)
                flow.request.headers.fields = tuple(
                    _sub_basic(k, v) for k, v in flow.request.headers.fields
                )
            else:
                flow.request.headers.fields = tuple(
                    (k, v.replace(placeholder_bytes, value_bytes)) if placeholder_bytes in v else (k, v)
                    for k, v in flow.request.headers.fields
                )
            if flow.request.content and placeholder_bytes in flow.request.content:
                flow.request.content = flow.request.content.replace(
                    placeholder_bytes, value_bytes
                )

    def request(self, flow: http.HTTPFlow):
        method = flow.request.method
        host = flow.request.pretty_host

        if not self._is_request_allowed(method, host):
            flow.response = http.Response.make(
                403,
                f"Blocked by network policy: {method} {host}\n".encode(),
                {"Content-Type": "text/plain"},
            )
            ctx.log.warn(f"Network deny: {method} {host}")
            return

        self._substitute_secrets(flow)

    def dns_request(self, flow: dns.DNSFlow):
        question = flow.request.question
        if question is None:
            flow.response = flow.request.fail(dns.response_codes.REFUSED)
            return

        host = question.name
        if not self._is_request_allowed(None, host):
            flow.response = flow.request.fail(dns.response_codes.REFUSED)
            ctx.log.warn(f"DNS deny: {host}")


addons = [SandcatAddon()]
