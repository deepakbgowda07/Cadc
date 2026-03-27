/**
 * RAG (Retrieval-Augmented Generation) Module
 * 
 * Handles:
 * - Indexing messages for semantic search
 * - Retrieving relevant messages based on queries
 * - Generating answers using LLM with context
 */

import { getAllMessages } from './storage';

const DB_NAME = 'qr_messages_db';
const EMBEDDINGS_STORE = 'message_embeddings';

let dbInstance = null;

/**
 * Initialize embeddings object store if it doesn't exist
 */
async function initEmbeddingsStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2); // Bump version for new store

    request.onerror = () => reject(request.error);
    
    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create embeddings store if it doesn't exist
      if (!db.objectStoreNames.contains(EMBEDDINGS_STORE)) {
        const store = db.createObjectStore(EMBEDDINGS_STORE, { keyPath: 'id' });
        store.createIndex('messageId', 'messageId', { unique: true });
        console.log('Embeddings store initialized');
      }
    };
  });
}

/**
 * Simple TF-IDF based text tokenization
 * Converts text to tokens for similarity calculation
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2);
}

/**
 * Calculate text similarity using simple keyword overlap (Jaccard similarity)
 */
function calculateSimilarity(query, text) {
  const queryTokens = new Set(tokenize(query));
  const textTokens = new Set(tokenize(text));

  if (queryTokens.size === 0 || textTokens.size === 0) return 0;

  const intersection = [...queryTokens].filter(token => textTokens.has(token)).length;
  const union = new Set([...queryTokens, ...textTokens]).size;

  return intersection / union;
}

/**
 * Extract key information from a message for RAG context
 */
function formatMessageForContext(message) {
  return `
[Message ID: ${message.id.slice(0, 12)}]
Type: ${message.type}
Author: ${message.author_role}
Location: ${message.location}
Hop Count: ${message.hop_count}
Content: ${message.content}
AI Classification: ${message.ai?.label || 'unverified'}
${message.ai?.summary ? `Summary: ${message.ai.summary}` : ''}
`.trim();
}

/**
 * Retrieve relevant messages for a query
 * @param {string} query - User question
 * @param {number} topK - Number of results to return (default 5)
 * @returns {Promise<Array>} Relevant messages with similarity scores
 */
export async function retrieveRelevantMessages(query, topK = 5) {
  try {
    const messages = await getAllMessages();

    // Calculate similarity scores for each message
    const scoredMessages = messages.map((msg) => {
      const messageText = `${msg.type} ${msg.content} ${msg.location} ${msg.ai?.summary || ''}`;
      const score = calculateSimilarity(query, messageText);

      return {
        ...msg,
        relevanceScore: score
      };
    });

    // Sort by relevance and return top-k
    return scoredMessages
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .filter(msg => msg.relevanceScore > 0)
      .slice(0, topK);
  } catch (error) {
    console.error('Error retrieving relevant messages:', error);
    return [];
  }
}

/**
 * Build context from relevant messages for LLM
 * @param {Array} relevantMessages - Messages retrieved from RAG
 * @returns {string} Formatted context string
 */
export function buildContextFromMessages(relevantMessages) {
  if (relevantMessages.length === 0) {
    return 'No relevant messages found in the database.';
  }

  const contextItems = relevantMessages.map((msg, idx) => {
    return `[Document ${idx + 1}]\n${formatMessageForContext(msg)}\nRelevance: ${(msg.relevanceScore * 100).toFixed(1)}%`;
  });

  return contextItems.join('\n\n---\n\n');
}

/**
 * Generate offline RAG-based answer using only available message data
 * Works completely without internet or API keys
 * @param {string} query - User question
 * @param {Array} relevantMessages - Retrieved messages
 * @returns {Promise<Object>} { answer, context, sources }
 */
export async function generateRAGAnswer(query, relevantMessages) {
  try {
    const answer = generateOfflineAnswer(query, relevantMessages);

    return {
      answer,
      context: buildContextFromMessages(relevantMessages),
      sources: relevantMessages.map((msg, idx) => ({
        id: msg.id,
        type: msg.type,
        relevance: msg.relevanceScore,
        index: idx + 1
      }))
    };
  } catch (error) {
    console.error('Error generating RAG answer:', error);
    return {
      answer: 'Error processing query. Please try again.',
      context: buildContextFromMessages(relevantMessages),
      sources: relevantMessages.map((msg, idx) => ({
        id: msg.id,
        type: msg.type,
        relevance: msg.relevanceScore,
        index: idx + 1
      }))
    };
  }
}

/**
 * Intelligent offline answer generator
 * Synthesizes information from retrieved messages without external APIs
 */
function generateOfflineAnswer(query, relevantMessages) {
  if (relevantMessages.length === 0) {
    return `No information found in the database matching "${query}". Try scanning more QR codes to populate the database with relevant messages.`;
  }

  // Parse query intent
  const lowerQuery = query.toLowerCase();
  const queryTokens = tokenize(query);

  // Extract key information from messages
  const messagesByType = {};
  const urgentMessages = [];
  const locationSet = new Set();
  const allContent = [];
  let totalHops = 0;

  relevantMessages.forEach((msg) => {
    // Group by type
    if (!messagesByType[msg.type]) {
      messagesByType[msg.type] = [];
    }
    messagesByType[msg.type].push(msg);

    // Track urgent messages
    if (msg.ai?.label === 'urgent') {
      urgentMessages.push(msg);
    }

    // Collect locations
    if (msg.location) {
      locationSet.add(msg.location);
    }

    // Collect content
    allContent.push(msg.content);
    totalHops += msg.hop_count || 0;
  });

  const locations = Array.from(locationSet);
  const avgHops = relevantMessages.length > 0 ? (totalHops / relevantMessages.length).toFixed(1) : 0;

  // Build answer based on query intent
  let answer = '';

  // Detect query type and generate appropriate answer
  if (containsKeywords(lowerQuery, ['urgent', 'emergency', 'priority', 'critical', 'alert'])) {
    if (urgentMessages.length > 0) {
      answer = `Found ${urgentMessages.length} urgent message(s):\n\n`;
      urgentMessages.slice(0, 3).forEach((msg, idx) => {
        answer += `${idx + 1}. [${msg.type.toUpperCase()}] ${msg.content.substring(0, 80)}...`;
        answer += msg.location ? ` (Location: ${msg.location})` : '';
        answer += msg.author_role ? ` (Source: ${msg.author_role})` : '';
        answer += `\n`;
      });
    } else {
      answer = 'No urgent messages found in the current database.';
    }
  } else if (containsKeywords(lowerQuery, ['medical', 'health', 'hospital', 'doctor', 'disease', 'illness'])) {
    if (messagesByType['medical']) {
      answer = `Found ${messagesByType['medical'].length} medical message(s):\n\n`;
      messagesByType['medical'].slice(0, 3).forEach((msg, idx) => {
        answer += `${idx + 1}. ${msg.content.substring(0, 80)}...`;
        answer += msg.location ? ` (${msg.location})` : '';
        answer += `\n`;
      });
    } else {
      answer = 'No medical messages found in the database.';
    }
  } else if (containsKeywords(lowerQuery, ['safety', 'danger', 'risk', 'threat', 'secure'])) {
    if (messagesByType['safety']) {
      answer = `Found ${messagesByType['safety'].length} safety related message(s):\n\n`;
      messagesByType['safety'].slice(0, 3).forEach((msg, idx) => {
        answer += `${idx + 1}. ${msg.content.substring(0, 80)}...`;
        answer += msg.location ? ` (${msg.location})` : '';
        answer += `\n`;
      });
    } else {
      answer = 'No safety-related messages found.';
    }
  } else if (containsKeywords(lowerQuery, ['missing', 'lost', 'find', 'search', 'person'])) {
    if (messagesByType['missing']) {
      answer = `Found ${messagesByType['missing'].length} missing person report(s):\n\n`;
      messagesByType['missing'].slice(0, 3).forEach((msg, idx) => {
        answer += `${idx + 1}. ${msg.content.substring(0, 80)}...`;
        answer += msg.location ? ` (Last seen: ${msg.location})` : '';
        answer += `\n`;
      });
    } else {
      answer = 'No missing person reports in the database.';
    }
  } else if (containsKeywords(lowerQuery, ['aid', 'help', 'support', 'resource', 'need', 'request'])) {
    if (messagesByType['aid']) {
      answer = `Found ${messagesByType['aid'].length} aid request(s):\n\n`;
      messagesByType['aid'].slice(0, 3).forEach((msg, idx) => {
        answer += `${idx + 1}. ${msg.content.substring(0, 80)}...`;
        answer += msg.location ? ` (Location: ${msg.location})` : '';
        answer += `\n`;
      });
    } else {
      answer = 'No aid requests found in the database.';
    }
  } else if (containsKeywords(lowerQuery, ['rumor', 'report', 'information', 'news'])) {
    if (messagesByType['rumor']) {
      answer = `Found ${messagesByType['rumor'].length} information report(s):\n\n`;
      messagesByType['rumor'].slice(0, 3).forEach((msg, idx) => {
        answer += `${idx + 1}. ${msg.content.substring(0, 80)}...`;
        answer += `\n`;
      });
    } else {
      answer = 'No information reports in the database.';
    }
  } else if (containsKeywords(lowerQuery, ['location', 'where', 'area', 'region', 'zone'])) {
    if (locations.length > 0) {
      answer = `Messages from these locations:\n\n`;
      locations.forEach((loc, idx) => {
        const count = relevantMessages.filter(m => m.location === loc).length;
        answer += `${idx + 1}. ${loc} (${count} message(s))\n`;
      });
    } else {
      answer = 'No location information available in the database.';
    }
  } else if (containsKeywords(lowerQuery, ['type', 'category', 'kind', 'message type'])) {
    const types = Object.keys(messagesByType);
    answer = `Message types in database:\n\n`;
    types.forEach((type, idx) => {
      answer += `${idx + 1}. ${type.toUpperCase()} - ${messagesByType[type].length} message(s)\n`;
    });
    answer += `\nTotal: ${relevantMessages.length} messages`;
  } else if (containsKeywords(lowerQuery, ['count', 'total', 'many', 'how many'])) {
    answer = `Database statistics:\n\n`;
    answer += `• Total messages: ${relevantMessages.length}\n`;
    answer += `• Urgent messages: ${urgentMessages.length}\n`;
    answer += `• Unique locations: ${locations.length}\n`;
    answer += `• Average hops: ${avgHops}\n`;
    Object.entries(messagesByType).forEach(([type, msgs]) => {
      answer += `• ${type.toUpperCase()}: ${msgs.length}\n`;
    });
  } else {
    // Generic answer for unmatched queries
    answer = `Found ${relevantMessages.length} relevant message(s):\n\n`;

    // Show top messages
    relevantMessages.slice(0, 3).forEach((msg, idx) => {
      answer += `${idx + 1}. [${msg.type.toUpperCase()}] ${msg.content.substring(0, 80)}...\n`;
      answer += `   Location: ${msg.location || 'Not specified'}\n`;
      answer += `   Author: ${msg.author_role || 'Unknown'}\n`;
      answer += `   Relevance: ${(msg.relevanceScore * 100).toFixed(0)}%\n\n`;
    });

    if (relevantMessages.length > 3) {
      answer += `\n(+ ${relevantMessages.length - 3} more messages - click sources to see all)`;
    }
  }

  return answer;
}

/**
 * Check if text contains any of the keywords
 */
function containsKeywords(text, keywords) {
  return keywords.some(keyword => text.includes(keyword));
}

/**
 * Full RAG pipeline: Query → Retrieve → Generate
 * @param {string} query - User question
 * @param {number} topK - Number of documents to retrieve
 * @returns {Promise<Object>} Complete RAG response
 */
export async function executeRAGQuery(query, topK = 5) {
  try {
    if (!query.trim()) {
      throw new Error('Query cannot be empty');
    }

    console.log('🔍 RAG Query:', query);

    // Step 1: Retrieve relevant messages
    const relevantMessages = await retrieveRelevantMessages(query, topK);
    console.log(`📚 Retrieved ${relevantMessages.length} relevant messages`);

    // Step 2: Generate answer
    const ragResponse = await generateRAGAnswer(query, relevantMessages);
    console.log('✅ Answer generated');

    return {
      success: true,
      query,
      ...ragResponse
    };
  } catch (error) {
    console.error('RAG execution error:', error);
    return {
      success: false,
      query,
      answer: `Error processing query: ${error.message}`,
      context: '',
      sources: [],
      error: error.message
    };
  }
}

/**
 * Get RAG statistics
 * @returns {Promise<Object>} Stats about indexed messages
 */
export async function getRAGStats() {
  try {
    const messages = await getAllMessages();

    const stats = {
      totalMessages: messages.length,
      messageTypes: {},
      authorRoles: {},
      avgHopCount: 0,
      urgentCount: 0,
      timeRange: {
        earliest: null,
        latest: null
      }
    };

    if (messages.length === 0) {
      return stats;
    }

    messages.forEach((msg) => {
      stats.messageTypes[msg.type] = (stats.messageTypes[msg.type] || 0) + 1;
      stats.authorRoles[msg.author_role] = (stats.authorRoles[msg.author_role] || 0) + 1;
      if (msg.ai?.label === 'urgent') stats.urgentCount++;
    });

    stats.avgHopCount = messages.reduce((sum, m) => sum + (m.hop_count || 0), 0) / messages.length;

    const timestamps = messages.map(m => m.timestamp).filter(t => t);
    if (timestamps.length > 0) {
      stats.timeRange.earliest = new Date(Math.min(...timestamps)).toISOString();
      stats.timeRange.latest = new Date(Math.max(...timestamps)).toISOString();
    }

    return stats;
  } catch (error) {
    console.error('Error getting RAG stats:', error);
    return {
      totalMessages: 0,
      messageTypes: {},
      authorRoles: {},
      avgHopCount: 0,
      urgentCount: 0,
      timeRange: null
    };
  }
}

/**
 * Clear embeddings cache (useful when messages are deleted)
 */
export async function clearEmbeddingsCache() {
  try {
    const db = await initEmbeddingsStore();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([EMBEDDINGS_STORE], 'readwrite');
      const store = transaction.objectStore(EMBEDDINGS_STORE);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        console.log('Embeddings cache cleared');
        resolve();
      };
    });
  } catch (error) {
    console.error('Error clearing embeddings cache:', error);
  }
}
