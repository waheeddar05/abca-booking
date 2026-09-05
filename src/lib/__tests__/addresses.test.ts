import { describe, it, expect } from 'vitest';
import {
  ADDRESS_LIMITS,
  AddressInputSchema,
  INDIAN_STATES,
  MAX_ADDRESSES_PER_USER,
  formatAddressLines,
  formatAddressSummary,
  normalizeIndianMobile,
} from '@/lib/addresses';

describe('normalizeIndianMobile', () => {
  it('returns the bare 10 digits for every common spelling', () => {
    expect(normalizeIndianMobile('9876543210')).toBe('9876543210');
    expect(normalizeIndianMobile('+91 98765 43210')).toBe('9876543210');
    expect(normalizeIndianMobile('09876543210')).toBe('9876543210');
    expect(normalizeIndianMobile('919876543210')).toBe('9876543210');
    expect(normalizeIndianMobile('98765-43210')).toBe('9876543210');
  });

  it('accepts a number typed as a number', () => {
    expect(normalizeIndianMobile(9876543210)).toBe('9876543210');
  });

  it('rejects short numbers, landlines and non-mobile prefixes', () => {
    expect(normalizeIndianMobile('12345')).toBeNull();
    expect(normalizeIndianMobile('02212345678')).toBeNull();
    expect(normalizeIndianMobile('5876543210')).toBeNull();
    expect(normalizeIndianMobile('00919876543210')).toBeNull();
  });

  it('rejects anything that is not a string or number', () => {
    expect(normalizeIndianMobile(null)).toBeNull();
    expect(normalizeIndianMobile(undefined)).toBeNull();
    expect(normalizeIndianMobile({})).toBeNull();
    expect(normalizeIndianMobile(['9876543210'])).toBeNull();
    expect(normalizeIndianMobile('')).toBeNull();
  });
});

const validAddress = {
  label: 'Home',
  fullName: 'Rahul Sharma',
  phone: '+91 98765 43210',
  line1: '12 MG Road',
  line2: 'Flat 4B',
  landmark: 'Opp. Café Coffee Day',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  isDefault: true,
};

describe('AddressInputSchema', () => {
  it('accepts a complete address and normalises the phone to 10 digits', () => {
    const parsed = AddressInputSchema.parse(validAddress);
    expect(parsed).toEqual({ ...validAddress, phone: '9876543210' });
  });

  it('turns a blank label / line2 / landmark into null and defaults isDefault to false', () => {
    const parsed = AddressInputSchema.parse({
      fullName: 'Rahul Sharma',
      phone: '9876543210',
      line1: '12 MG Road',
      label: '',
      line2: '   ',
      landmark: null,
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
    });
    expect(parsed.label).toBeNull();
    expect(parsed.line2).toBeNull();
    expect(parsed.landmark).toBeNull();
    expect(parsed.isDefault).toBe(false);
  });

  it('rejects a PIN code that is not six digits or starts with zero', () => {
    for (const pincode of ['41100', '4110011', '011001', 'ABCDEF', '']) {
      const parsed = AddressInputSchema.safeParse({ ...validAddress, pincode });
      expect(parsed.success, `pincode=${pincode}`).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message).toBe('Enter a valid 6-digit PIN code');
      }
    }
  });

  it('rejects an unusable phone with the mobile message', () => {
    const parsed = AddressInputSchema.safeParse({ ...validAddress, phone: '12345' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe('Enter a valid 10-digit Indian mobile number');
    }
  });

  it('requires a city and a state', () => {
    const noCity = { ...validAddress } as Partial<typeof validAddress>;
    delete noCity.city;
    expect(AddressInputSchema.safeParse(noCity).success).toBe(false);
    expect(AddressInputSchema.safeParse({ ...validAddress, city: ' ' }).success).toBe(false);
    expect(AddressInputSchema.safeParse({ ...validAddress, state: '' }).success).toBe(false);
  });

  it('rejects a recipient name with no letters in it', () => {
    const parsed = AddressInputSchema.safeParse({ ...validAddress, fullName: '1234 --' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe('Enter the recipient’s name using letters');
    }
    // Non-Latin letters are letters too.
    expect(AddressInputSchema.safeParse({ ...validAddress, fullName: 'राहुल शर्मा' }).success).toBe(true);
  });

  it('requires a name of at least two characters and a real first line', () => {
    expect(AddressInputSchema.safeParse({ ...validAddress, fullName: 'R' }).success).toBe(false);
    expect(AddressInputSchema.safeParse({ ...validAddress, line1: '12' }).success).toBe(false);
  });

  it('enforces the field length limits', () => {
    expect(
      AddressInputSchema.safeParse({ ...validAddress, label: 'x'.repeat(ADDRESS_LIMITS.label + 1) })
        .success,
    ).toBe(false);
    expect(
      AddressInputSchema.safeParse({ ...validAddress, line1: 'x'.repeat(ADDRESS_LIMITS.line1 + 1) })
        .success,
    ).toBe(false);
  });

  it('does not coerce a string isDefault — the form sends a real boolean', () => {
    expect(AddressInputSchema.safeParse({ ...validAddress, isDefault: 'true' }).success).toBe(false);
  });
});

describe('formatAddressLines', () => {
  const full = {
    fullName: 'Rahul Sharma',
    phone: '9876543210',
    line1: '12 MG Road',
    line2: 'Flat 4B',
    landmark: 'Opp. Café Coffee Day',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411001',
  };

  it('lays the address out postal-style with the phone last', () => {
    expect(formatAddressLines(full)).toEqual([
      'Rahul Sharma',
      '12 MG Road',
      'Flat 4B',
      'Landmark: Opp. Café Coffee Day',
      'Pune, Maharashtra 411001',
      'Phone: 9876543210',
    ]);
  });

  it('skips the optional lines when they are empty', () => {
    expect(formatAddressLines({ ...full, line2: null, landmark: null })).toEqual([
      'Rahul Sharma',
      '12 MG Road',
      'Pune, Maharashtra 411001',
      'Phone: 9876543210',
    ]);
  });
});

describe('formatAddressSummary', () => {
  it('prefixes the label when there is one', () => {
    expect(formatAddressSummary({ label: 'Home', line1: '12 MG Road', city: 'Pune', pincode: '411001' })).toBe(
      'Home · 12 MG Road, Pune 411001',
    );
  });

  it('is just the address when there is no label', () => {
    expect(formatAddressSummary({ label: null, line1: '12 MG Road', city: 'Pune', pincode: '411001' })).toBe(
      '12 MG Road, Pune 411001',
    );
  });
});

describe('limits and catalog', () => {
  it('caps a user at five addresses', () => {
    expect(MAX_ADDRESSES_PER_USER).toBe(5);
  });

  it('lists every state and union territory once', () => {
    expect(new Set(INDIAN_STATES).size).toBe(INDIAN_STATES.length);
    expect(INDIAN_STATES).toContain('Maharashtra');
    expect(INDIAN_STATES).toContain('Delhi');
  });
});
