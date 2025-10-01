/**
 * Tests for Input Validator
 */

const {
  sanitizeHtml,
  sanitizeChatMessage,
  validateDisplayName,
  validateRoomId,
  validatePayloadSize,
  validateInteger,
  validateBoolean,
  validateStringLength,
  validateEnum,
  validateObject,
  validateJoinRoomPayload,
  validateChatMessagePayload,
  validateHostSettingsPayload,
  LIMITS,
  VALID_ROOM_IDS,
} = require('../../src/modules/security/inputValidator');

describe('Input Validator', () => {
  describe('sanitizeHtml', () => {
    test('should remove HTML tags', () => {
      const input = '<script>alert("xss")</script>Hello';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('</script>');
      expect(result).toContain('Hello');
    });

    test('should remove encoded HTML entities', () => {
      const input = '&lt;script&gt;alert("xss")&lt;/script&gt;';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('&lt;');
      expect(result).not.toContain('&gt;');
    });

    test('should remove javascript: protocol', () => {
      const input = 'Click <a href="javascript:alert(1)">here</a>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('javascript:');
    });

    test('should remove event handlers', () => {
      const input = '<div onclick="alert(1)">Click me</div>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('onclick=');
      expect(result).toContain('Click me');
    });

    test('should preserve safe text', () => {
      const input = 'Hello, World! How are you?';
      const result = sanitizeHtml(input);
      expect(result).toBe(input);
    });
  });

  describe('sanitizeChatMessage', () => {
    test('should sanitize and return valid message', () => {
      const result = sanitizeChatMessage('Hello, World!');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('Hello, World!');
    });

    test('should remove XSS attempts', () => {
      const result = sanitizeChatMessage('<script>alert("xss")</script>Hello');
      expect(result.valid).toBe(true);
      expect(result.sanitized).not.toContain('<script>');
      expect(result.sanitized).toContain('Hello');
    });

    test('should normalize whitespace', () => {
      const result = sanitizeChatMessage('Hello    World  \n\n  Test');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('Hello World Test');
    });

    test('should truncate long messages', () => {
      const longMessage = 'a'.repeat(LIMITS.MAX_CHAT_MESSAGE_LENGTH + 100);
      const result = sanitizeChatMessage(longMessage);
      expect(result.valid).toBe(true);
      expect(result.sanitized.length).toBeLessThanOrEqual(LIMITS.MAX_CHAT_MESSAGE_LENGTH);
    });

    test('should reject empty messages', () => {
      const result = sanitizeChatMessage('   ');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('validateDisplayName', () => {
    test('should accept valid display names', () => {
      const validNames = ['Player1', 'John Doe', 'Alice123', 'Bob'];
      
      validNames.forEach(name => {
        const result = validateDisplayName(name);
        expect(result.valid).toBe(true);
        expect(result.normalized).toBeDefined();
      });
    });

    test('should reject names that are too short', () => {
      const result = validateDisplayName('AB');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('characters');
    });

    test('should reject names that are too long', () => {
      const longName = 'a'.repeat(LIMITS.MAX_DISPLAY_NAME_LENGTH + 1);
      const result = validateDisplayName(longName);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('characters');
    });

    test('should reject names with special characters', () => {
      const result = validateDisplayName('Player@123');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('letters, numbers');
    });

    test('should normalize whitespace', () => {
      const result = validateDisplayName('  John   Doe  ');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('John Doe');
    });
  });

  describe('validateRoomId', () => {
    test('should accept valid room IDs', () => {
      VALID_ROOM_IDS.forEach(roomId => {
        const result = validateRoomId(roomId);
        expect(result.valid).toBe(true);
        expect(result.normalized).toBe(roomId);
      });
    });

    test('should accept valid room IDs with mixed case', () => {
      const result = validateRoomId('ITAJUBA');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('itajuba');
    });

    test('should reject invalid room IDs', () => {
      const result = validateRoomId('invalid-room');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('valid room');
    });

    test('should normalize room IDs', () => {
      const result = validateRoomId('  Campinas  ');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('campinas');
    });
  });

  describe('validatePayloadSize', () => {
    test('should accept small payloads', () => {
      const payload = { message: 'Hello' };
      const result = validatePayloadSize(payload);
      expect(result.valid).toBe(true);
      expect(result.size).toBeLessThan(LIMITS.MAX_PAYLOAD_SIZE);
    });

    test('should reject oversized payloads', () => {
      const largePayload = { data: 'a'.repeat(LIMITS.MAX_PAYLOAD_SIZE + 100) };
      const result = validatePayloadSize(largePayload);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too large');
    });
  });

  describe('validateInteger', () => {
    test('should accept valid integers in range', () => {
      const result = validateInteger(5, 1, 10, 'testField');
      expect(result.valid).toBe(true);
      expect(result.value).toBe(5);
    });

    test('should reject non-integers', () => {
      const result = validateInteger('not a number', 1, 10, 'testField');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('integer');
    });

    test('should reject out-of-range integers', () => {
      const result1 = validateInteger(0, 1, 10, 'testField');
      const result2 = validateInteger(11, 1, 10, 'testField');
      
      expect(result1.valid).toBe(false);
      expect(result2.valid).toBe(false);
      expect(result1.error).toContain('between');
    });
  });

  describe('validateBoolean', () => {
    test('should accept boolean values', () => {
      expect(validateBoolean(true, 'test').valid).toBe(true);
      expect(validateBoolean(false, 'test').valid).toBe(true);
    });

    test('should reject non-boolean values', () => {
      expect(validateBoolean('true', 'test').valid).toBe(false);
      expect(validateBoolean(1, 'test').valid).toBe(false);
      expect(validateBoolean(null, 'test').valid).toBe(false);
    });
  });

  describe('validateStringLength', () => {
    test('should accept strings within length bounds', () => {
      const result = validateStringLength('hello', 3, 10, 'test');
      expect(result.valid).toBe(true);
      expect(result.value).toBe('hello');
    });

    test('should reject strings that are too short', () => {
      const result = validateStringLength('ab', 3, 10, 'test');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('between');
    });

    test('should reject strings that are too long', () => {
      const result = validateStringLength('a'.repeat(11), 3, 10, 'test');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('between');
    });
  });

  describe('validateEnum', () => {
    test('should accept values in allowed list', () => {
      const result = validateEnum('option1', ['option1', 'option2'], 'test');
      expect(result.valid).toBe(true);
      expect(result.value).toBe('option1');
    });

    test('should reject values not in allowed list', () => {
      const result = validateEnum('option3', ['option1', 'option2'], 'test');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('one of');
    });
  });

  describe('validateObject', () => {
    test('should validate object against schema', () => {
      const schema = {
        name: {
          required: true,
          validate: (value) => validateStringLength(value, 3, 20, 'name'),
        },
        age: {
          required: false,
          default: 0,
          validate: (value) => validateInteger(value, 0, 100, 'age'),
        },
      };

      const result = validateObject({ name: 'John' }, schema);
      expect(result.valid).toBe(true);
      expect(result.validated.name).toBe('John');
      expect(result.validated.age).toBe(0); // Default value
    });

    test('should reject objects missing required fields', () => {
      const schema = {
        name: {
          required: true,
          validate: (value) => validateStringLength(value, 3, 20, 'name'),
        },
      };

      const result = validateObject({}, schema);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Field 'name' is required");
    });

    test('should accumulate multiple validation errors', () => {
      const schema = {
        name: {
          required: true,
          validate: (value) => validateStringLength(value, 3, 20, 'name'),
        },
        age: {
          required: true,
          validate: (value) => validateInteger(value, 0, 100, 'age'),
        },
      };

      const result = validateObject({ name: 'ab', age: 'not a number' }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('validateJoinRoomPayload', () => {
    test('should validate valid join room payload', () => {
      const payload = {
        roomId: 'itajuba',
        displayName: 'Player1',
        spectator: false,
      };

      const result = validateJoinRoomPayload(payload);
      expect(result.valid).toBe(true);
      expect(result.validated.roomId).toBe('itajuba');
      expect(result.validated.displayName).toBe('Player1');
    });

    test('should use default for spectator if not provided', () => {
      const payload = {
        roomId: 'itajuba',
        displayName: 'Player1',
      };

      const result = validateJoinRoomPayload(payload);
      expect(result.valid).toBe(true);
      expect(result.validated.spectator).toBe(false);
    });

    test('should reject invalid room ID', () => {
      const payload = {
        roomId: 'invalid-room',
        displayName: 'Player1',
      };

      const result = validateJoinRoomPayload(payload);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('should reject invalid display name', () => {
      const payload = {
        roomId: 'itajuba',
        displayName: 'AB', // Too short
      };

      const result = validateJoinRoomPayload(payload);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateChatMessagePayload', () => {
    test('should validate valid chat message', () => {
      const payload = { message: 'Hello, World!' };
      const result = validateChatMessagePayload(payload);
      
      expect(result.valid).toBe(true);
      expect(result.validated.message).toBe('Hello, World!');
    });

    test('should sanitize XSS in chat message', () => {
      const payload = { message: '<script>alert("xss")</script>Hello' };
      const result = validateChatMessagePayload(payload);
      
      expect(result.valid).toBe(true);
      expect(result.validated.message).toBeDefined();
      expect(result.validated.message).not.toContain('<script>');
      expect(result.validated.message).toContain('Hello');
    });

    test('should reject empty message', () => {
      const payload = { message: '   ' };
      const result = validateChatMessagePayload(payload);
      
      expect(result.valid).toBe(false);
    });
  });

  describe('validateHostSettingsPayload', () => {
    test('should validate valid host settings', () => {
      const payload = {
        startingLives: 5,
        turnTimerSeconds: 10,
        spectatorChatEnabled: true,
      };

      const result = validateHostSettingsPayload(payload);
      expect(result.valid).toBe(true);
      expect(result.validated.startingLives).toBe(5);
    });

    test('should reject invalid startingLives', () => {
      const payload = { startingLives: 0 }; // Below minimum
      const result = validateHostSettingsPayload(payload);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('should reject invalid turnTimerSeconds', () => {
      const payload = { turnTimerSeconds: 100 }; // Above maximum
      const result = validateHostSettingsPayload(payload);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('should accept partial payloads with valid fields', () => {
      const payload = { startingLives: 3 };
      const result = validateHostSettingsPayload(payload);
      
      expect(result.valid).toBe(true);
      expect(result.validated.startingLives).toBe(3);
    });
  });

  describe('Configuration constants', () => {
    test('should have reasonable limits defined', () => {
      expect(LIMITS.MAX_DISPLAY_NAME_LENGTH).toBeGreaterThan(LIMITS.MIN_DISPLAY_NAME_LENGTH);
      expect(LIMITS.MAX_CHAT_MESSAGE_LENGTH).toBeGreaterThan(0);
      expect(LIMITS.MAX_PAYLOAD_SIZE).toBeGreaterThan(0);
    });

    test('should have valid room IDs configured', () => {
      expect(VALID_ROOM_IDS.size).toBeGreaterThan(0);
      VALID_ROOM_IDS.forEach(roomId => {
        expect(typeof roomId).toBe('string');
        expect(roomId.length).toBeGreaterThan(0);
      });
    });
  });
});
