/**
 * Clio Viewer Logic Module
 * Extracted for testability - these functions are also inlined in viewer.html
 */

const FILE_SIZE_WARNING = 5 * 1024 * 1024;  // 5MB
const FILE_SIZE_LIMIT = 20 * 1024 * 1024;   // 20MB

/**
 * Format bytes to human-readable size
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Format ISO date string to locale string
 * @param {string} isoString
 * @returns {string}
 */
function formatDate(isoString) {
  if (!isoString) return 'Unknown date';
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return 'Invalid date';
  }
}

/**
 * Validate conversation JSON structure
 * @param {object} json
 * @returns {boolean}
 * @throws {Error} if validation fails
 */
function validateConversation(json) {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid JSON: not an object');
  }
  if (!json.metadata || typeof json.metadata !== 'object') {
    throw new Error('Missing or invalid metadata');
  }
  if (!Array.isArray(json.messages)) {
    throw new Error('Missing or invalid messages array');
  }
  for (let i = 0; i < json.messages.length; i++) {
    const turn = json.messages[i];
    if (!turn.role || !['user', 'assistant'].includes(turn.role)) {
      throw new Error(`Turn ${i}: invalid role "${turn.role}"`);
    }
    if (typeof turn.content !== 'string') {
      throw new Error(`Turn ${i}: content must be string`);
    }
  }
  return true;
}

/**
 * Check if file size is within limits
 * @param {number} size - file size in bytes
 * @returns {{ valid: boolean, warning: boolean, error: string | null }}
 */
function checkFileSize(size) {
  if (size > FILE_SIZE_LIMIT) {
    return {
      valid: false,
      warning: false,
      error: `File exceeds 20MB limit (${formatSize(size)})`
    };
  }
  if (size > FILE_SIZE_WARNING) {
    return {
      valid: true,
      warning: true,
      error: null
    };
  }
  return {
    valid: true,
    warning: false,
    error: null
  };
}

/**
 * Check if filename is valid for loading
 * @param {string} filename
 * @returns {{ valid: boolean, error: string | null }}
 */
function checkFilename(filename) {
  if (!filename.endsWith('.json')) {
    return {
      valid: false,
      error: 'Only .json files supported'
    };
  }
  return {
    valid: true,
    error: null
  };
}

module.exports = {
  FILE_SIZE_WARNING,
  FILE_SIZE_LIMIT,
  formatSize,
  formatDate,
  validateConversation,
  checkFileSize,
  checkFilename
};
