#!/usr/bin/env python3
"""Client GitHub Actions pour le point de déploiement étudiant IHME."""

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


def required_settings(environment):
    names = ("DEPLOY_URL", "DEPLOY_TOKEN", "DIGEST")
    missing = [name for name in names if not environment.get(name)]
    if missing:
        raise ValueError(
            "Configuration de déploiement absente pour : "
            + ", ".join(missing)
            + ". Vérifier les secrets et variables Actions du dépôt ou l'environnement GitHub associé au job."
        )
    return tuple(environment[name] for name in names)


def request_deployment(url, token, digest, registry_token=""):
    address = urllib.parse.urlsplit(url)
    if (
        address.scheme != "https"
        or not address.hostname
        or address.username
        or address.password
        or address.query
        or address.fragment
        or not re.fullmatch(r"/__deploy/p[0-9]{2}", address.path)
    ):
        raise ValueError("URL HTTPS de déploiement invalide.")
    if not token or not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        raise ValueError("Jeton privé et digest SHA-256 requis.")

    body = {"digest": digest}
    if registry_token:
        body["registry_token"] = registry_token
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token,
        },
    )

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None

    with urllib.request.build_opener(NoRedirect()).open(
        request, timeout=440
    ) as response:
        data = json.load(response)
        if response.status != 200 or data.get("status") != "healthy":
            raise ValueError("Version non saine.")
        return data


if __name__ == "__main__":
    try:
        deploy_url, deploy_token, digest = required_settings(os.environ)
        result = request_deployment(
            deploy_url,
            deploy_token,
            digest,
            os.environ.get("REGISTRY_TOKEN", ""),
        )
        print("Déploiement vérifié : " + result["project"] + " @ " + result["digest"])
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            message = "Le serveur refuse l'accès : vérifier le jeton et l'identifiant de projet attribués."
        elif error.code == 404:
            message = "Point de déploiement introuvable : vérifier l'URL HTTPS et le chemin /__deploy/pNN."
        elif error.code == 429:
            message = "Trop de tentatives de déploiement ; attendre une minute avant de réessayer."
        elif error.code >= 500:
            message = "Le service de déploiement est momentanément indisponible."
        else:
            message = f"Le serveur a refusé la requête (HTTP {error.code})."
        print(message, file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError:
        print("Impossible de joindre le serveur de déploiement. Vérifier l'URL et la connexion.", file=sys.stderr)
        sys.exit(1)
    except (ValueError, OSError):
        print("Configuration ou réponse de déploiement invalide. Vérifier l'URL, le digest et le résumé du workflow.", file=sys.stderr)
        sys.exit(1)
