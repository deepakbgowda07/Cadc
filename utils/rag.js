/**
 * RAG (Retrieval-Augmented Generation) Module
 * 
 * Handles:
 * - Indexing messages for semantic search
 * - Loading emergency knowledge base (300+ entries)
 * - Retrieving relevant messages + KB entries based on queries
 * - Generating answers using LLM with context
 */

import { getAllMessages } from './storage';

const DB_NAME = 'qr_messages_db';
const EMBEDDINGS_STORE = 'message_embeddings';
const KB_URL = '/data/emergency_knowledge_base.json';

let dbInstance = null;
let knowledgeBase = null;

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
 * Load emergency knowledge base from JSON file
 * Contains 300+ life-saving entries for war/disaster scenarios
 */
export async function loadEmergencyKnowledgeBase() {
  if (knowledgeBase) {
    return knowledgeBase; // Already loaded, return cached
  }

  try {
    console.log('📖 Loading emergency knowledge base...');
    const response = await fetch(KB_URL);
    
    if (!response.ok) {
      console.error(`Failed to load KB: ${response.status}`);
      return [];
    }

    knowledgeBase = await response.json();
    console.log(`✅ Loaded ${knowledgeBase.length} KB entries`);
    return knowledgeBase;
  } catch (error) {
    console.error('Error loading knowledge base:', error);
    return [];
  }
}

/**
 * Convert KB entry to searchable message format
 */
function formatKBEntryAsMessage(entry) {
  const keywords = entry.keywords ? entry.keywords.join(' ') : '';
  const searchText = `${entry.title} ${entry.summary} ${entry.answer || entry.details || ''} ${keywords}`;
  
  return {
    id: `kb_${entry.id}`,
    type: entry.category,
    content: entry.summary || entry.answer || entry.title,
    full_answer: entry.answer || entry.details || entry.summary,
    location: entry.location || '',
    author_role: 'Knowledge Base',
    ai: {
      label: entry.priority === 'CRITICAL' ? 'urgent' : 'verified',
      summary: entry.summary
    },
    hop_count: 0,
    source: 'KNOWLEDGE_BASE',
    entry: entry,
    searchText: searchText,
    isKBEntry: true,
    priority: entry.priority || 'MEDIUM'
  };
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
  // Handle knowledge base entries differently
  if (message.isKBEntry) {
    return `
[Knowledge Base Entry ID: ${message.entry.id}]
Category: ${message.entry.category}
Priority: ${message.entry.priority || 'MEDIUM'}
Title: ${message.entry.title}
Summary: ${message.entry.summary}
${message.entry.answer ? `Answer: ${message.entry.answer}` : ''}
${message.entry.details ? `Details: ${message.entry.details}` : ''}
${message.entry.location ? `Location: ${message.entry.location}` : ''}
Keywords: ${message.entry.keywords ? message.entry.keywords.join(', ') : 'None'}
Reliability: ${message.entry.reliability || 'VERIFIED'}
    `.trim();
  }

  // Handle scanned messages
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
 * Retrieve relevant messages for a query (from both scanned messages + knowledge base)
 * @param {string} query - User question
 * @param {number} topK - Number of results to return (default 5)
 * @returns {Promise<Array>} Relevant messages with similarity scores
 */
export async function retrieveRelevantMessages(query, topK = 5) {
  try {
    // Fetch both scanned messages and knowledge base entries
    const scannedMessages = await getAllMessages();
    const kbEntries = await loadEmergencyKnowledgeBase();

    // Convert KB entries to message format
    const kbMessages = kbEntries.map(entry => formatKBEntryAsMessage(entry));

    // Combine all sources
    const allSources = [...scannedMessages, ...kbMessages];

    console.log(`🔎 Searching ${scannedMessages.length} scanned messages + ${kbMessages.length} KB entries`);

    // Calculate similarity scores for each item
    const scoredResults = allSources.map((item) => {
      // Use searchText if available (for KB), otherwise construct from content
      const searchableText = item.searchText || `${item.type || ''} ${item.content || ''} ${item.location || ''} ${item.ai?.summary || ''}`;
      const score = calculateSimilarity(query, searchableText);

      return {
        ...item,
        relevanceScore: score
      };
    });

    // Sort by relevance (prioritize CRITICAL priority KB entries in ties)
    const sortedResults = scoredResults.sort((a, b) => {
      const scoreEqual = Math.abs(b.relevanceScore - a.relevanceScore) < 0.01;
      if (scoreEqual && a.priority && b.priority) {
        const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
      }
      return b.relevanceScore - a.relevanceScore;
    });

    return sortedResults
      .filter(item => item.relevanceScore > 0)
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
 * Synthesizes information from both scanned messages and knowledge base entries
 */
function generateOfflineAnswer(query, relevantMessages) {
  if (relevantMessages.length === 0) {
    return `No information found in the database matching "${query}". Try scanning more QR codes to populate the database with relevant messages.`;
  }

  // Separate KB entries from scanned messages
  const kbEntries = relevantMessages.filter(msg => msg.isKBEntry);
  const scannedMessages = relevantMessages.filter(msg => !msg.isKBEntry);

  // If we have critical KB entries, prioritize showing them
  const criticalKBEntries = kbEntries.filter(msg => msg.priority === 'CRITICAL');
  
  if (criticalKBEntries.length > 0) {
    let answer = `🚨 CRITICAL GUIDANCE FOUND:\n\n`;
    
    criticalKBEntries.slice(0, 3).forEach((entry, idx) => {
      const actualEntry = entry.entry || entry;
      answer += `${idx + 1}. ${actualEntry.title} [${actualEntry.category}]\n`;
      
      if (actualEntry.answer) {
        answer += `\n${actualEntry.answer}\n`;
      } else if (actualEntry.details) {
        answer += `\n${actualEntry.details}\n`;
      }
      
      if (actualEntry.contact) {
        answer += `\nContact: ${actualEntry.contact}\n`;
      }
      
      answer += `\n---\n\n`;
    });
    
    return answer.trim();
  }

  // If we have any KB entries, show them first
  if (kbEntries.length > 0) {
    let answer = `📚 KNOWLEDGE BASE:\n\n`;
    
    kbEntries.slice(0, 3).forEach((entry, idx) => {
      const actualEntry = entry.entry || entry;
      answer += `${idx + 1}. ${actualEntry.title}\n`;
      answer += `   Priority: ${actualEntry.priority || 'MEDIUM'}\n`;
      answer += `   Category: ${actualEntry.category}\n\n`;
      
      if (actualEntry.answer) {
        answer += `${actualEntry.answer}\n`;
      } else if (actualEntry.summary) {
        answer += `${actualEntry.summary}\n`;
        if (actualEntry.details) {
          answer += `\nDetails: ${actualEntry.details}\n`;
        }
      }
      
      if (actualEntry.location) {
        answer += `\nLocation: ${actualEntry.location}\n`;
      }
      
      if (actualEntry.contact) {
        answer += `Contact: ${actualEntry.contact}\n`;
      }
      
      answer += `\n---\n\n`;
    });
    
    if (scannedMessages.length > 0) {
      answer += `\n📱 SCANNED MESSAGES (${scannedMessages.length} found):\n`;
      scannedMessages.slice(0, 2).forEach((msg, idx) => {
        answer += `${idx + 1}. [${msg.type.toUpperCase()}] ${msg.content.substring(0, 100)}...\n`;
        answer += `   From: ${msg.author_role || 'Unknown'} at ${msg.location || 'Unknown location'}\n\n`;
      });
    }
    
    return answer.trim();
  }

  // Fallback: Show scanned messages only
  const lowerQuery = query.toLowerCase();
  const messagesByType = {};
  const urgentMessages = [];
  const locationSet = new Set();

  scannedMessages.forEach((msg) => {
    if (!messagesByType[msg.type]) {
      messagesByType[msg.type] = [];
    }
    messagesByType[msg.type].push(msg);

    if (msg.ai?.label === 'urgent') {
      urgentMessages.push(msg);
    }

    if (msg.location) {
      locationSet.add(msg.location);
    }
  });

  const locations = Array.from(locationSet);
  let answer = '';

  // Detect query type and generate appropriate answer for scanned messages
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
  } else {
    // Generic answer
    answer = `Found ${scannedMessages.length} relevant message(s):\n\n`;
    scannedMessages.slice(0, 3).forEach((msg, idx) => {
      answer += `${idx + 1}. [${msg.type.toUpperCase()}] ${msg.content.substring(0, 80)}...\n`;
      answer += `   Location: ${msg.location || 'Not specified'}\n`;
      answer += `   Relevance: ${(msg.relevanceScore * 100).toFixed(0)}%\n\n`;
    });

    if (scannedMessages.length > 3) {
      answer += `(+ ${scannedMessages.length - 3} more messages)`;
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
