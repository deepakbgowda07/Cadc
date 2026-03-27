/**
 * Storage Layer (IndexedDB)
 * 
 * Handles persistence of messages using IndexedDB.
 * Deduplicates by message ID.
 * Provides async CRUD operations for messages.
 * Built for RAG capabilities with optimized indexes.
 */

const DB_NAME = 'qr_messages_db';
const DB_VERSION = 1;
const STORE_NAME = 'messages';

let dbInstance = null;

/**
 * Initialize IndexedDB database
 * @returns {Promise<IDBDatabase>} Database instance
 */
async function initDB() {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Database error:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });

        // Create indexes for efficient querying and RAG
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('author_id', 'author_id', { unique: false });
        store.createIndex('hop_count', 'hop_count', { unique: false });
        store.createIndex('ai_label', 'ai_label', { unique: false });
        store.createIndex('created_at', 'created_at', { unique: false });

        console.log('IndexedDB initialized with object store and indexes');
      }
    };
  });
}

/**
 * Get all messages from IndexedDB, sorted by timestamp (newest first)
 * @returns {Promise<Array>} Array of stored messages
 */
async function getStoredMessages() {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onerror = () => {
        console.error('Error reading from IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        const messages = request.result || [];
        // Sort by timestamp (newest first)
        messages.sort((a, b) => b.timestamp - a.timestamp);
        resolve(messages);
      };
    });
  } catch (error) {
    console.error('Error reading from IndexedDB:', error);
    return [];
  }
}

/**
 * Write a single message to IndexedDB
 * @param {Object} message - Message to store
 * @returns {Promise<Object>} The stored message
 */
async function addMessageToDB(message) {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(message); // put = insert or update

      request.onerror = () => {
        console.error('Error writing to IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        resolve(message);
      };
    });
  } catch (error) {
    console.error('Error writing to IndexedDB:', error);
    throw error;
  }
}

/**
 * Save a single message to IndexedDB
 * Deduplicates by ID - if message with same ID exists, updates it
 * @param {Object} message - Message to save
 * @returns {Promise<Object>} The saved message
 */
export async function saveMessage(message) {
  return addMessageToDB(message);
}

/**
 * Get all stored messages
 * @returns {Promise<Array>} All messages sorted by timestamp (newest first)
 */
export async function getAllMessages() {
  return getStoredMessages();
}

/**
 * Get a single message by ID
 * @param {string} id - Message ID
 * @returns {Promise<Object|null>} Message or null if not found
 */
export async function getMessageById(id) {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onerror = () => {
        console.error('Error reading message from IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        resolve(request.result || null);
      };
    });
  } catch (error) {
    console.error('Error reading message from IndexedDB:', error);
    return null;
  }
}

/**
 * Check if a message with given ID already exists
 * Used to prevent duplicate processing
 * @param {string} id - Message ID
 * @returns {Promise<boolean>}
 */
export async function messageExists(id) {
  const message = await getMessageById(id);
  return message !== null;
}

/**
 * Delete a message by ID
 * @param {string} id - Message ID
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
export async function deleteMessage(id) {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        if (getRequest.result) {
          const deleteRequest = store.delete(id);
          deleteRequest.onsuccess = () => {
            resolve(true);
          };
          deleteRequest.onerror = () => {
            reject(deleteRequest.error);
          };
        } else {
          resolve(false);
        }
      };

      getRequest.onerror = () => {
        reject(getRequest.error);
      };
    });
  } catch (error) {
    console.error('Error deleting message from IndexedDB:', error);
    return false;
  }
}

/**
 * Clear all messages from IndexedDB
 * WARNING: This is destructive
 * @returns {Promise<void>}
 */
export async function clearAllMessages() {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onerror = () => {
        console.error('Error clearing IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        console.log('All messages cleared from IndexedDB');
        resolve();
      };
    });
  } catch (error) {
    console.error('Error clearing IndexedDB:', error);
    throw error;
  }
}

/**
 * Get storage statistics
 * @returns {Promise<Object>} { totalMessages, storageSize }
 */
export async function getStorageStats() {
  try {
    const messages = await getStoredMessages();
    const storageSize = new Blob([JSON.stringify(messages)]).size; // in bytes

    return {
      totalMessages: messages.length,
      storageSizeBytes: storageSize,
      storageSizeKB: (storageSize / 1024).toFixed(2),
      storageType: 'IndexedDB'
    };
  } catch (error) {
    console.error('Error getting storage stats:', error);
    return {
      totalMessages: 0,
      storageSizeBytes: 0,
      storageSizeKB: '0',
      storageType: 'IndexedDB'
    };
  }
}

/**
 * Export all messages as JSON (for backup)
 * @returns {Promise<string>} JSON string of all messages
 */
export async function exportMessagesAsJSON() {
  const messages = await getStoredMessages();
  return JSON.stringify(messages, null, 2);
}

/**
 * Import messages from JSON
 * Merges with existing messages, deduplicates by ID
 * @param {string} jsonString - JSON string to import
 * @returns {Promise<Object>} { success: boolean, imported: number, errors: string[] }
 */
export async function importMessagesFromJSON(jsonString) {
  const errors = [];
  let imported = 0;

  try {
    const importedMessages = JSON.parse(jsonString);

    if (!Array.isArray(importedMessages)) {
      throw new Error('Imported data must be an array');
    }

    const existing = await getStoredMessages();
    const db = await initDB();

    // Check each imported message
    for (const msg of importedMessages) {
      if (!existing.find((m) => m.id === msg.id)) {
        await addMessageToDB(msg);
        imported++;
      }
    }

    return {
      success: true,
      imported,
      errors
    };
  } catch (error) {
    return {
      success: false,
      imported: 0,
      errors: [error.message]
    };
  }
}

/**
 * Query messages by type (useful for RAG filtering)
 * @param {string} type - Message type
 * @returns {Promise<Array>} Messages matching the type
 */
export async function getMessagesByType(type) {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('type');
      const request = index.getAll(type);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const messages = request.result || [];
        messages.sort((a, b) => b.timestamp - a.timestamp);
        resolve(messages);
      };
    });
  } catch (error) {
    console.error('Error querying messages by type:', error);
    return [];
  }
}

/**
 * Query messages by AI label (useful for RAG filtering)
 * @param {string} label - AI label (e.g., 'urgent', 'safe', 'unverified')
 * @returns {Promise<Array>} Messages matching the label
 */
export async function getMessagesByAILabel(label) {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('ai_label');
      const request = index.getAll(label);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const messages = request.result || [];
        messages.sort((a, b) => b.timestamp - a.timestamp);
        resolve(messages);
      };
    });
  } catch (error) {
    console.error('Error querying messages by AI label:', error);
    return [];
  }
}

/**
 * Get messages within a timestamp range (useful for RAG time-based filtering)
 * @param {number} startTime - Start timestamp
 * @param {number} endTime - End timestamp
 * @returns {Promise<Array>} Messages within the range
 */
export async function getMessagesByTimeRange(startTime, endTime) {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const range = IDBKeyRange.bound(startTime, endTime);
      const request = index.getAll(range);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const messages = request.result || [];
        messages.sort((a, b) => b.timestamp - a.timestamp);
        resolve(messages);
      };
    });
  } catch (error) {
    console.error('Error querying messages by time range:', error);
    return [];
  }
}
