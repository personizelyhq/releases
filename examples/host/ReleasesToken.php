<?php

namespace App\Service;

/**
 * Mints short-lived user tokens for @personizely/releases.
 * Same format the package verifies: v1.<base64url(json)>.<base64url(hmac-sha256)>
 */
final class ReleasesToken
{
    public function __construct(private readonly string $secret)
    {
    }

    public function forUser(string|int $userId, ?\DateTimeInterface $since = null, int $ttl = 3600): string
    {
        $payload = ['sub' => (string) $userId, 'exp' => time() + $ttl];
        if ($since !== null) {
            $payload['since'] = $since->format(\DATE_ATOM);
        }

        $encoded = self::b64url(json_encode($payload, \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_SLASHES));
        $signature = self::b64url(hash_hmac('sha256', 'v1.' . $encoded, $this->secret, true));

        return 'v1.' . $encoded . '.' . $signature;
    }

    private static function b64url(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
}
