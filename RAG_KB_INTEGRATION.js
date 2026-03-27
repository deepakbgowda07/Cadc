// ============================================================================
// EMERGENCY KNOWLEDGE BASE INTEGRATION
// Add this to utils/rag.js to use the structured emergency knowledge
// ============================================================================

/**
 * STEP 1: Load the emergency knowledge base
 * Call this once on app initialization
 */

let EMERGENCY_KB = null;
let KB_LOAD_PROMISE = null;

async function loadEmergencyKB() {
  // Return cached KB if already loaded
  if (EMERGENCY_KB) {
    return EMERGENCY_KB;
  }

  // Prevent multiple simultaneous loads
  if (KB_LOAD_PROMISE) {
    return KB_LOAD_PROMISE;
  }

  KB_LOAD_PROMISE = (async () => {
    try {
      console.log('📚 Loading emergency knowledge base...');
      
      const response = await fetch('/data/emergency_knowledge_base.json');
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      EMERGENCY_KB = await response.json();
      
      console.log(`✅ Loaded ${EMERGENCY_KB.length} KB entries`);
      console.log('📊 Category breakdown:', {
        safe_zones: EMERGENCY_KB.filter(e => e.category === 'SAFE_ZONES').length,
        danger_zones: EMERGENCY_KB.filter(e => e.category === 'DANGER_ZONES').length,
        medical: EMERGENCY_KB.filter(e => e.category === 'MEDICAL_HELP').length,
        faq: EMERGENCY_KB.filter(e => e.category === 'FAQ').length
      });
      
      // Build search index for faster retrieval
      buildKBSearchIndex();
      
      return EMERGENCY_KB;
    } catch (error) {
      console.error('❌ Failed to load emergency KB:', error);
      EMERGENCY_KB = [];
      return [];
    }
  })();

  return KB_LOAD_PROMISE;
}

/**
 * STEP 2: Build search index for performance
 */

let KB_SEARCH_INDEX = {};

function buildKBSearchIndex() {
  console.log('🔍 Building KB search index...');
  
  KB_SEARCH_INDEX = {};
  
  EMERGENCY_KB.forEach((entry, idx) => {
    // Index all keywords
    const keywords = [
      ...(entry.keywords || []),
      entry.title || '',
      entry.category || '',
      entry.question || '',
      entry.summary || ''
    ];
    
    keywords.forEach(keyword => {
      const normalized = keyword.toLowerCase().trim();
      if (!normalized) return;
      
      if (!KB_SEARCH_INDEX[normalized]) {
        KB_SEARCH_INDEX[normalized] = [];
      }
      
      if (!KB_SEARCH_INDEX[normalized].includes(idx)) {
        KB_SEARCH_INDEX[normalized].push(idx);
      }
    });
  });
  
  console.log('✅ KB search index built:', Object.keys(KB_SEARCH_INDEX).length, 'keywords');
}

/**
 * STEP 3: Search emergency KB with priority ranking
 */

function searchEmergencyKB(query, topK = 5) {
  if (!EMERGENCY_KB || EMERGENCY_KB.length === 0) {
    console.warn('⚠️ Emergency KB not loaded');
    return [];
  }

  // Tokenize query
  const queryTokens = query.toLowerCase().split(/\s+/);
  
  // Find matching entries
  const candidates = [];
  
  EMERGENCY_KB.forEach((entry, idx) => {
    // Calculate relevance
    const summaryScore = calculateSimilarity(
      query, 
      (entry.summary || '') + ' ' + (entry.title || '')
    );
    
    const keywordMatches = entry.keywords 
      ? queryTokens.filter(token => 
          entry.keywords.some(kw => kw.toLowerCase().includes(token))
        ).length 
      : 0;
    
    const categoryBoost = query.toLowerCase().includes(entry.category.toLowerCase()) ? 0.2 : 0;
    
    const relevance = (summaryScore * 0.6) + (keywordMatches * 0.2) + categoryBoost;
    
    if (relevance > 0.1) {
      candidates.push({
        ...entry,
        relevance,
        source: 'KB',
        entry_id: `kb_${idx}`
      });
    }
  });

  // Rank by priority + relevance
  candidates.sort((a, b) => {
    const priorityMap = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
    const priorityDiff = (priorityMap[b.priority] || 0) - (priorityMap[a.priority] || 0);
    
    if (Math.abs(priorityDiff) > 0.5) return priorityDiff;
    return b.relevance - a.relevance;
  });

  return candidates.slice(0, topK);
}

/**
 * STEP 4: Detect if query is time-critical (needs immediate response)
 */

function isTimeCriticalQuery(query) {
  const criticalKeywords = [
    'bleeding', 'emergency', 'urgent', 'dying', 'critical', 'now',
    'help', 'immediate', 'dangerous', 'shooting', 'gunfire',
    'choking', 'unconscious', 'seizure', 'poison', 'trauma',
    'severe pain', 'can\'t breathe', 'chest pain'
  ];

  const queryLower = query.toLowerCase();
  
  return criticalKeywords.some(kw => queryLower.includes(kw));
}

/**
 * STEP 5: Merge KB results with message results
 */

async function retrieveRelevantMessages(query, topK = 5) {
  // Load KB
  await loadEmergencyKB();

  // Check if time-critical
  const isCritical = isTimeCriticalQuery(query);

  // Retrieve from KB (higher weight for critical queries)
  const kbResults = searchEmergencyKB(query, isCritical ? topK : Math.floor(topK * 0.6));

  // Retrieve from IndexedDB messages
  const messages = await getAllMessages();
  const messageResults = messages
    .map(msg => ({
      ...msg,
      relevance: calculateSimilarity(query, msg.content),
      source: 'Messages',
      entry_id: msg.id
    }))
    .filter(m => m.relevance > 0.3)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, isCritical ? Math.floor(topK * 0.2) : Math.floor(topK * 0.4));

  // Combine: KB first, then messages
  let combined = [...kbResults, ...messageResults];
  
  // Deduplicate by concept (similar entries)
  combined = deduplicateResults(combined);
  
  // Return top K
  return combined.slice(0, topK);
}

/**
 * STEP 6: Format KB entries in answer
 */

function formatKBEntryAsAnswer(entry) {
  let formatted = '';

  // CRITICAL entries get warning header
  if (entry.priority === 'CRITICAL') {
    formatted += '🚨 URGENT RESPONSE\n';
    formatted += '='.repeat(40) + '\n\n';
  } else if (entry.priority === 'HIGH') {
    formatted += '⚠️ IMPORTANT\n';
  }

  // Title
  formatted += `📌 ${entry.title}\n`;

  // Category badge
  formatted += `[${entry.category}] `;
  formatted += `Status: ${entry.status || 'N/A'} `;
  if (entry.location) formatted += `| Location: ${entry.location}`;
  formatted += '\n\n';

  // Main content
  if (entry.answer) {
    formatted += `ANSWER:\n${entry.answer}\n\n`;
  } else if (entry.summary) {
    formatted += `SUMMARY:\n${entry.summary}\n\n`;
  } else if (entry.details) {
    formatted += `DETAILS:\n${entry.details}\n\n`;
  }

  // Additional fields
  if (entry.contact) {
    formatted += `📞 CONTACT: ${entry.contact}\n`;
  }

  if (entry.keywords && entry.keywords.length > 0) {
    formatted += `📝 Related: ${entry.keywords.join(', ')}\n`;
  }

  // Reliability indicator
  if (entry.reliability === 'UNVERIFIED') {
    formatted += `\n⚠️ Note: This information is UNVERIFIED. Use caution.\n`;
  }

  formatted += `\nℹ️ Last updated: ${entry.last_updated || 'Unknown'}\n`;

  return formatted;
}

/**
 * STEP 7: Updated answer generation (integrate KB)
 */

async function generateOfflineAnswer(query, relevantMessages) {
  console.log('🤖 Generating offline answer with KB integration...');

  if (!relevantMessages || relevantMessages.length === 0) {
    return 'Sorry, I couldn\'t find relevant information. Try asking about a specific location, medical emergency, or resource.';
  }

  // Separate KB entries from messages
  const kbEntries = relevantMessages.filter(m => m.source === 'KB');
  const messages = relevantMessages.filter(m => m.source !== 'KB');

  let answer = '';

  // If high-priority KB entry exists, lead with it
  if (kbEntries.length > 0) {
    const topKBEntry = kbEntries[0];
    answer += formatKBEntryAsAnswer(topKBEntry);

    if (messages.length > 0) {
      answer += '\n' + '='.repeat(40) + '\n';
      answer += 'ADDITIONAL FIELD REPORTS:\n\n';
    }
  }

  // Add message context
  if (messages.length > 0) {
    messages.slice(0, 3).forEach((msg, idx) => {
      answer += `📌 Report ${idx + 1}:\n`;
      answer += `"${msg.content}"\n`;
      if (msg.author) answer += `From: ${msg.author} | `;
      if (msg.timestamp) answer += `Time: ${new Date(msg.timestamp).toLocaleString()}\n`;
      answer += '\n';
    });
  }

  console.log('✅ Answer generated with KB + field data');
  
  return answer;
}

/**
 * STEP 8: Update main RAG query function
 */

async function executeRAGQuery(query, topK = 5) {
  try {
    console.log('🔍 RAG Query:', query);
    console.log(`⏱️ Time-critical: ${isTimeCriticalQuery(query)}`);

    // Load KB first
    await loadEmergencyKB();

    // Retrieve relevant information
    const relevantMessages = await retrieveRelevantMessages(query, topK);

    // Check if we have KB entries
    const hasKBResults = relevantMessages.some(r => r.source === 'KB');
    
    console.log(`📚 Results: ${relevantMessages.length} items (${
      relevantMessages.filter(r => r.source === 'KB').length
    } from KB, ${
      relevantMessages.filter(r => r.source === 'Messages').length
    } from messages)`);

    if (relevantMessages.length === 0) {
      return { answer: 'No information found. Please check the message feed or ask a different question.' };
    }

    // Generate answer
    const answer = await generateOfflineAnswer(query, relevantMessages);

    return {
      answer,
      sources: relevantMessages.map(m => ({
        id: m.entry_id,
        title: m.title || m.content?.substring(0, 50),
        relevance: m.relevance,
        source: m.source,
        priority: m.priority || 'N/A'
      }))
    };
  } catch (error) {
    console.error('❌ RAG Error:', error);
    return { answer: `Error processing query: ${error.message}` };
  }
}

/**
 * STEP 9: Helper function to deduplicate results
 */

function deduplicateResults(results) {
  const seen = new Set();
  const deduplicated = [];

  results.forEach(result => {
    // Use title/summary as dedup key
    const key = (result.title || result.content || '').substring(0, 50).toLowerCase();
    
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(result);
    }
  });

  return deduplicated;
}

/**
 * STEP 10: Initialize KB on app load
 */

// Call this once in your App.jsx useEffect
export async function initializeRAGSystem() {
  console.log('🚀 Initializing RAG system...');
  
  try {
    await loadEmergencyKB();
    console.log('✅ RAG system ready');
  } catch (error) {
    console.error('❌ Failed to initialize RAG:', error);
  }
}

/**
 * STEP 11: Get RAG system stats (for dashboard)
 */

function getRAGStats() {
  return {
    totalKBEntries: EMERGENCY_KB?.length || 0,
    categories: [...new Set(EMERGENCY_KB?.map(e => e.category) || [])],
    criticalEntries: EMERGENCY_KB?.filter(e => e.priority === 'CRITICAL').length || 0,
    verifiedEntries: EMERGENCY_KB?.filter(e => e.reliability === 'VERIFIED').length || 0,
    lastLoaded: new Date().toISOString()
  };
}

// ============================================================================
// EXPORT FOR USE IN RAGChat.jsx
// ============================================================================

export {
  executeRAGQuery,
  loadEmergencyKB,
  isTimeCriticalQuery,
  searchEmergencyKB,
  getRAGStats,
  initializeRAGSystem
};

/**
 * ============================================================================
 * USAGE IN RAGChat.jsx
 * ============================================================================
 * 
 * import { executeRAGQuery, initializeRAGSystem } from '../utils/rag';
 * 
 * // On component mount
 * useEffect(() => {
 *   initializeRAGSystem();
 * }, []);
 * 
 * // When user asks a question
 * const handleAsk = async () => {
 *   const result = await executeRAGQuery(userQuery);
 *   setMessages([...messages, {
 *     type: 'assistant',
 *     text: result.answer,
 *     sources: result.sources
 *   }]);
 * };
 * 
 * ============================================================================
 */
