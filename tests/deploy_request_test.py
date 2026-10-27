import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deploy.request import request_deployment


class FakeResponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps({"status": "healthy", "project": "p01", "digest": "sha256:" + "a" * 64}).encode()


class FakeOpener:
    def __init__(self):
        self.request = None

    def open(self, request, timeout):
        self.request = request
        if timeout != 440:
            raise AssertionError("Unexpected deployment timeout")
        return FakeResponse()


class DeploymentRequestTests(unittest.TestCase):
    def test_sends_digest_and_registry_token_to_assigned_https_endpoint(self):
        opener = FakeOpener()
        digest = "sha256:" + "a" * 64
        with patch("deploy.request.urllib.request.build_opener", return_value=opener):
            result = request_deployment(
                "https://deploy.example/__deploy/p01",
                "private-token",
                digest,
                "temporary-registry-token",
            )

        self.assertEqual(result["status"], "healthy")
        self.assertEqual(opener.request.get_header("Authorization"), "Bearer private-token")
        self.assertEqual(
            json.loads(opener.request.data),
            {"digest": digest, "registry_token": "temporary-registry-token"},
        )

    def test_rejects_non_https_or_unassigned_endpoint(self):
        for url in (
            "http://deploy.example/__deploy/p01",
            "https://deploy.example/__deploy/suivi",
            "https://deploy.example/__deploy/p01?token=leak",
            "https://user:pass@deploy.example/__deploy/p01",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                request_deployment(url, "private-token", "sha256:" + "a" * 64)

    def test_rejects_mutable_image_tags(self):
        with self.assertRaises(ValueError):
            request_deployment(
                "https://deploy.example/__deploy/p01",
                "private-token",
                "latest",
            )


if __name__ == "__main__":
    unittest.main()
