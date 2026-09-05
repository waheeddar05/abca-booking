import { describe, it, expect } from 'vitest';
import { DEFAULT_POST_LOGIN_PATH, loginHref, safeNextPath } from '../login-href';

/**
 * `/?login=1&next=…` is the only place the app takes a redirect target from
 * the URL, so it must never become an open redirect.
 */
describe('safeNextPath', () => {
  it('keeps a same-origin path, with its query and hash', () => {
    expect(safeNextPath('/shop/abc123')).toBe('/shop/abc123');
    expect(safeNextPath('/shop?category=BAT')).toBe('/shop?category=BAT');
    expect(safeNextPath('/shop/abc#specs')).toBe('/shop/abc#specs');
  });

  it('drops absolute and protocol-relative URLs', () => {
    expect(safeNextPath('https://evil.example/')).toBeNull();
    expect(safeNextPath('//evil.example/')).toBeNull();
    expect(safeNextPath('/\\evil.example')).toBeNull();
    expect(safeNextPath('javascript:alert(1)')).toBeNull();
  });

  it('drops anything with whitespace, empty values and the landing page itself', () => {
    expect(safeNextPath('/shop abc')).toBeNull();
    expect(safeNextPath('/shop\nabc')).toBeNull();
    expect(safeNextPath('')).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath('/')).toBeNull();
    expect(safeNextPath('/?login=1')).toBeNull();
  });

  it('drops absurdly long paths', () => {
    expect(safeNextPath('/' + 'a'.repeat(600))).toBeNull();
  });
});

describe('loginHref', () => {
  it('encodes a valid return path', () => {
    expect(loginHref('/shop/abc?x=1')).toBe('/?login=1&next=%2Fshop%2Fabc%3Fx%3D1');
  });

  it('omits next when the path is unusable', () => {
    expect(loginHref('https://evil.example')).toBe('/?login=1');
    expect(loginHref(null)).toBe('/?login=1');
    expect(loginHref(undefined)).toBe('/?login=1');
  });

  it('defaults the post-login landing to the booking screen', () => {
    expect(DEFAULT_POST_LOGIN_PATH).toBe('/slots');
  });
});
