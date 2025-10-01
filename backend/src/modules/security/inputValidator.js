/**
 * Input Validation & Sanitization Module
 * 
 * Provides comprehensive input validation and sanitization for all user inputs.
 * Protects against XSS, injection attacks, and malformed data.
 * 
 * Features:
 * - HTML/XSS sanitization
 * - Payload size validation
 * - Type validation
 * - Range validation
 * - Regex-based validation
 * - Safe error messages
 */

// We'll use a simple regex-based sanitizer instead of DOMPurify to avoid dependencies
// For production, consider using DOMPurify: const DOMPurify = require('isomorphic-dompurify');

// Validation constants
const LIMITS = {
  MAX_DISPLAY_NAME_LENGTH: 20,
  MIN_DISPLAY_NAME_LENGTH: 3,
  MAX_CHAT_MESSAGE_LENGTH: 500,
  MAX_PAYLOAD_SIZE: 1024, // 1KB max payload size
  MAX_ARRAY_LENGTH: 100,
  MAX_STRING_LENGTH: 1000,
};

// Regex patterns
const PATTERNS = {
  DISPLAY_NAME: /^[a-zA-Z0-9\s]{3,20}$/,
  ALPHANUMERIC: /^[a-zA-Z0-9]+$/,
  SAFE_STRING: /^[a-zA-Z0-9\s\-_.,!?'"]+$/,
};

// Room IDs (from spec)
const VALID_ROOM_IDS = new Set([
  'itajuba',
  'piranguinho',
  'volta-redonda',
  'xique-xique',
  'campinas',
]);

/**
 * Sanitize HTML/XSS from text input
 * @param {string} text - Text to sanitize
 * @returns {string} - Sanitized text
 */
function sanitizeHtml(text) {
  if (typeof text !== 'string') {
    return '';
  }
  
  // Remove HTML tags and potentially dangerous characters
  let sanitized = text
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/&lt;/g, '')     // Remove encoded < 
    .replace(/&gt;/g, '')     // Remove encoded >
    .replace(/&amp;/g, '&')   // Decode &
    .replace(/&quot;/g, '"')  // Decode "
    .replace(/&#x27;/g, "'")  // Decode '
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+\s*=/gi, '');  // Remove event handlers like onclick=
  
  return sanitized.trim();
}

/**
 * Sanitize chat message
 * @param {string} message - Chat message to sanitize
 * @returns {Object} - { valid: boolean, sanitized: string, error?: string }
 */
function sanitizeChatMessage(message) {
  if (typeof message !== 'string') {
    return {
      valid: false,
      sanitized: '',
      error: 'Message must be a string',
    };
  }
  
  // Remove HTML/XSS
  let sanitized = sanitizeHtml(message);
  
  // Normalize whitespace
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  
  // Check length
  if (sanitized.length === 0) {
    return {
      valid: false,
      sanitized: '',
      error: 'Message cannot be empty',
    };
  }
  
  if (sanitized.length > LIMITS.MAX_CHAT_MESSAGE_LENGTH) {
    sanitized = sanitized.slice(0, LIMITS.MAX_CHAT_MESSAGE_LENGTH);
  }
  
  return {
    valid: true,
    sanitized,
  };
}

/**
 * Validate display name
 * @param {string} name - Display name to validate
 * @returns {Object} - { valid: boolean, normalized?: string, error?: string }
 */
function validateDisplayName(name) {
  if (typeof name !== 'string') {
    return {
      valid: false,
      error: 'Display name must be a string',
    };
  }
  
  // Normalize whitespace
  const normalized = name.replace(/\s+/g, ' ').trim();
  
  // Check pattern
  if (!PATTERNS.DISPLAY_NAME.test(normalized)) {
    return {
      valid: false,
      error: 'Display name must be 3-20 characters (letters, numbers, spaces)',
    };
  }
  
  return {
    valid: true,
    normalized,
  };
}

/**
 * Validate room ID
 * @param {string} roomId - Room ID to validate
 * @returns {Object} - { valid: boolean, normalized?: string, error?: string }
 */
function validateRoomId(roomId) {
  if (typeof roomId !== 'string') {
    return {
      valid: false,
      error: 'Room ID must be a string',
    };
  }
  
  const normalized = roomId.trim().toLowerCase();
  
  if (!VALID_ROOM_IDS.has(normalized)) {
    return {
      valid: false,
      error: 'Invalid room ID',
    };
  }
  
  return {
    valid: true,
    normalized,
  };
}

/**
 * Validate payload size
 * @param {any} payload - Payload to check
 * @returns {Object} - { valid: boolean, size?: number, error?: string }
 */
function validatePayloadSize(payload) {
  try {
    const size = JSON.stringify(payload).length;
    
    if (size > LIMITS.MAX_PAYLOAD_SIZE) {
      return {
        valid: false,
        size,
        error: `Payload too large (${size} bytes, max ${LIMITS.MAX_PAYLOAD_SIZE} bytes)`,
      };
    }
    
    return {
      valid: true,
      size,
    };
  } catch (error) {
    return {
      valid: false,
      error: 'Payload cannot be serialized',
    };
  }
}

/**
 * Validate integer in range
 * @param {any} value - Value to validate
 * @param {number} min - Minimum value (inclusive)
 * @param {number} max - Maximum value (inclusive)
 * @param {string} fieldName - Field name for error messages
 * @returns {Object} - { valid: boolean, value?: number, error?: string }
 */
function validateInteger(value, min, max, fieldName = 'Value') {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return {
      valid: false,
      error: `${fieldName} must be an integer`,
    };
  }
  
  if (value < min || value > max) {
    return {
      valid: false,
      error: `${fieldName} must be between ${min} and ${max}`,
    };
  }
  
  return {
    valid: true,
    value,
  };
}

/**
 * Validate boolean
 * @param {any} value - Value to validate
 * @param {string} fieldName - Field name for error messages
 * @returns {Object} - { valid: boolean, value?: boolean, error?: string }
 */
function validateBoolean(value, fieldName = 'Value') {
  if (typeof value !== 'boolean') {
    return {
      valid: false,
      error: `${fieldName} must be a boolean`,
    };
  }
  
  return {
    valid: true,
    value,
  };
}

/**
 * Validate string length
 * @param {any} value - Value to validate
 * @param {number} minLength - Minimum length
 * @param {number} maxLength - Maximum length
 * @param {string} fieldName - Field name for error messages
 * @returns {Object} - { valid: boolean, value?: string, error?: string }
 */
function validateStringLength(value, minLength, maxLength, fieldName = 'String') {
  if (typeof value !== 'string') {
    return {
      valid: false,
      error: `${fieldName} must be a string`,
    };
  }
  
  if (value.length < minLength || value.length > maxLength) {
    return {
      valid: false,
      error: `${fieldName} must be between ${minLength} and ${maxLength} characters`,
    };
  }
  
  return {
    valid: true,
    value,
  };
}

/**
 * Validate enum value
 * @param {any} value - Value to validate
 * @param {Array} allowedValues - Allowed values
 * @param {string} fieldName - Field name for error messages
 * @returns {Object} - { valid: boolean, value?: any, error?: string }
 */
function validateEnum(value, allowedValues, fieldName = 'Value') {
  if (!allowedValues.includes(value)) {
    return {
      valid: false,
      error: `${fieldName} must be one of: ${allowedValues.join(', ')}`,
    };
  }
  
  return {
    valid: true,
    value,
  };
}

/**
 * Validate object shape
 * @param {any} obj - Object to validate
 * @param {Object} schema - Schema with validators
 * @returns {Object} - { valid: boolean, validated?: Object, errors?: Array }
 */
function validateObject(obj, schema) {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return {
      valid: false,
      errors: ['Value must be an object'],
    };
  }
  
  const validated = {};
  const errors = [];
  
  // Check required fields
  for (const [key, validator] of Object.entries(schema)) {
    const value = obj[key];
    
    if (validator.required && value === undefined) {
      errors.push(`Field '${key}' is required`);
      continue;
    }
    
    if (value === undefined) {
      if (validator.default !== undefined) {
        validated[key] = validator.default;
      }
      continue;
    }
    
    // Run validator
    const result = validator.validate(value, key);
    
    if (!result.valid) {
      errors.push(result.error || `Field '${key}' is invalid`);
    } else {
      // Handle different return value keys
      validated[key] = result.value !== undefined ? result.value :
                      result.normalized !== undefined ? result.normalized :
                      result.sanitized !== undefined ? result.sanitized :
                      value;
    }
  }
  
  if (errors.length > 0) {
    return {
      valid: false,
      errors,
    };
  }
  
  return {
    valid: true,
    validated,
  };
}

/**
 * Validate join room payload
 * @param {any} payload - Payload to validate
 * @returns {Object} - { valid: boolean, validated?: Object, errors?: Array }
 */
function validateJoinRoomPayload(payload) {
  const schema = {
    roomId: {
      required: true,
      validate: validateRoomId,
    },
    displayName: {
      required: true,
      validate: validateDisplayName,
    },
    spectator: {
      required: false,
      default: false,
      validate: (value) => validateBoolean(value, 'spectator'),
    },
  };
  
  // First check payload size
  const sizeCheck = validatePayloadSize(payload);
  if (!sizeCheck.valid) {
    return {
      valid: false,
      errors: [sizeCheck.error],
    };
  }
  
  return validateObject(payload, schema);
}

/**
 * Validate chat message payload
 * @param {any} payload - Payload to validate
 * @returns {Object} - { valid: boolean, validated?: Object, errors?: Array }
 */
function validateChatMessagePayload(payload) {
  const schema = {
    message: {
      required: true,
      validate: (value) => sanitizeChatMessage(value),
    },
  };
  
  const sizeCheck = validatePayloadSize(payload);
  if (!sizeCheck.valid) {
    return {
      valid: false,
      errors: [sizeCheck.error],
    };
  }
  
  return validateObject(payload, schema);
}

/**
 * Validate host settings payload
 * @param {any} payload - Payload to validate
 * @returns {Object} - { valid: boolean, validated?: Object, errors?: Array }
 */
function validateHostSettingsPayload(payload) {
  const schema = {
    startingLives: {
      required: false,
      validate: (value) => validateInteger(value, 1, 10, 'Starting lives'),
    },
    turnTimerSeconds: {
      required: false,
      validate: (value) => validateInteger(value, 5, 30, 'Turn timer'),
    },
    spectatorChatEnabled: {
      required: false,
      validate: (value) => validateBoolean(value, 'Spectator chat'),
    },
  };
  
  const sizeCheck = validatePayloadSize(payload);
  if (!sizeCheck.valid) {
    return {
      valid: false,
      errors: [sizeCheck.error],
    };
  }
  
  return validateObject(payload, schema);
}

module.exports = {
  // Sanitization functions
  sanitizeHtml,
  sanitizeChatMessage,
  
  // Validation functions
  validateDisplayName,
  validateRoomId,
  validatePayloadSize,
  validateInteger,
  validateBoolean,
  validateStringLength,
  validateEnum,
  validateObject,
  
  // Payload validators
  validateJoinRoomPayload,
  validateChatMessagePayload,
  validateHostSettingsPayload,
  
  // Constants
  LIMITS,
  PATTERNS,
  VALID_ROOM_IDS,
};
