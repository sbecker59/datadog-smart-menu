const test = require('node:test');
const assert = require('node:assert/strict');
const { totp, sanitize, siteUrl } = require('../scripts/capture-navbar.js');

test('totp matches the RFC 6238 SHA-1 test vectors (6 digits)', () => {
  // Secret "12345678901234567890" in base32.
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totp(secret, 59 * 1000), '287082');
  assert.equal(totp(secret, 1111111109 * 1000), '081804');
  assert.equal(totp(secret, 1234567890 * 1000), '005924');
});

test('sanitize removes personal data from the user menu', () => {
  const links = sanitize([
    {
      menu: 'Incident Response',
      items: [
        { section: 'On-Call', label: 'Profile', href: '/personal-settings/profile?tab=on-call-notifications' },
        { section: 'On-Call', label: 'Teams', href: '/on-call/teams#main' }
      ]
    },
    {
      menu: 'jane@example.com jane@example.com acme acme',
      items: [
        { section: 'Personal Settings jane@example.com', label: 'Personal Settings', href: '/personal-settings' },
        { section: 'Personal Settings jane@example.com', label: 'Log In to Mobile', href: '/personal-settings/organizations/qrcode?orgUuid=123' },
        { section: 'Organization Settings acme acme', label: 'Organization Settings', href: '/organization-settings' },
        { section: 'Organization Settings acme acme', label: 'Users', href: '/organization-settings/users' },
        { section: 'Organization Settings acme acme', label: 'Docs', href: 'https://docs.datadoghq.com/' }
      ]
    }
  ]);

  assert.deepEqual(links, [
    { menu: 'Incident Response', section: 'On-Call', label: 'Profile', href: '/personal-settings/profile?tab=on-call-notifications' },
    { menu: 'Incident Response', section: 'On-Call', label: 'Teams', href: '/on-call/teams' },
    { menu: 'User menu', section: 'Personal Settings', label: 'Personal Settings', href: '/personal-settings' },
    { menu: 'User menu', section: 'Organization Settings', label: 'Organization Settings', href: '/organization-settings' },
    { menu: 'User menu', section: 'Organization Settings', label: 'Users', href: '/organization-settings/users' }
  ]);
});

test('siteUrl accepts Datadog site names and URLs', () => {
  assert.equal(siteUrl(undefined), 'https://app.datadoghq.eu');
  assert.equal(siteUrl('datadoghq.eu'), 'https://app.datadoghq.eu');
  assert.equal(siteUrl('datadoghq.com'), 'https://app.datadoghq.com');
  assert.equal(siteUrl('us3.datadoghq.com'), 'https://us3.datadoghq.com');
  assert.equal(siteUrl('ap1.datadoghq.com'), 'https://ap1.datadoghq.com');
  assert.equal(siteUrl('ddog-gov.com'), 'https://app.ddog-gov.com');
  assert.equal(siteUrl('https://app.datadoghq.eu/'), 'https://app.datadoghq.eu');
});

test('sanitize keeps the account popover menu and drops per-user team links', () => {
  const links = sanitize([{
    menu: 'User menu',
    isUserMenu: true,
    items: [
      { section: 'Account', label: 'My Profile', href: '/personal-settings/profile' },
      { section: 'Account', label: 'My stack', href: '/teams/4fac2366-0e3d-41de-904b-f847c4a9e03a/my-stack' },
      { section: 'Account', label: 'Plan & Usage', href: '/billing' },
      { section: 'Account', label: 'Log In To Mobile', href: '/personal-settings/organizations/qrcode?orgUuid=123' }
    ]
  }]);
  assert.deepEqual(links, [
    { menu: 'User menu', section: 'Account', label: 'My Profile', href: '/personal-settings/profile' },
    { menu: 'User menu', section: 'Account', label: 'Plan & Usage', href: '/billing' }
  ]);
});
