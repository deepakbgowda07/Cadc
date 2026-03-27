/**
 * RAGChat - React Component
 * 
 * Q&A interface using offline RAG system
 * Works completely without internet or API keys
 * All processing is local using IndexedDB messages
 */

import React, { useState, useRef, useEffect } from 'react';
import { executeRAGQuery, getRAGStats } from '../utils/rag';

const SUGGESTED_QUESTIONS = [
  // Life-Critical
  "Someone is bleeding heavily. What do I do?",
  "Person can't breathe / chest pain. Help?",
  "Gunfire nearby. What do I do?",
  
  // Medical
  "How to treat burns?",
  "Fracture / broken bone. What now?",
  
  // Safety & Locations
  "Where can I go to be safe?",
  "Is Eastern Market safe?",
  "Which areas should I avoid?",
  
  // Resources
  "Where can I get drinking water?",
  "When is food distributed?",
  "Where is baby formula?",
  
  // Navigation
  "How to get to the safe zone?",
  "What's the safest evacuation route?",
  
  // Family & Missing
  "My family is separated. What do I do?",
  
  // Information
  "What's the current situation?",
  "How many shelter beds are available?"
];

export default function RAGChat() {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      type: 'system',
      text: '🔒 Fully Offline RAG Q&A System\n\nNo internet required. Complete local processing.\n\nBuilt-in emergency knowledge base with 116+ life-saving answers. Click suggested questions below or ask anything!'
    }
  ]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [showStats, setShowStats] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    loadStats();
  }, []);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  async function loadStats() {
    try {
      const ragStats = await getRAGStats();
      setStats(ragStats);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }

  async function handleAsk(e) {
    e.preventDefault();
    if (!query.trim()) return;

    // Add user message to chat
    const userMessage = {
      id: Date.now().toString(),
      type: 'user',
      text: query
    };
    setMessages(prev => [...prev, userMessage]);
    setQuery('');
    setLoading(true);

    try {
      // Execute RAG query
      const result = await executeRAGQuery(query, 5);

      // Add assistant message with answer
      const assistantMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        text: result.answer,
        sources: result.sources,
        context: result.context
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage = {
        id: (Date.now() + 1).toString(),
        type: 'error',
        text: `Error: ${error.message}`
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleSuggestedQuestion(question) {
    setQuery(question);
    // Focus input for user to review before submitting
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.title}>
          <span style={styles.titleText}>Offline RAG Q&A</span>
          <span style={styles.subtitle}>No Internet Required • Local Processing</span>
        </div>
        <button
          onClick={() => setShowStats(!showStats)}
          style={styles.statsBtn}
          title="Show database statistics"
        >
          📊
        </button>
      </div>

      {/* STATS PANEL */}
      {showStats && stats && (
        <div style={styles.statsPanel}>
          <div style={styles.statRow}>
            <span style={styles.statKey}>Total Messages</span>
            <span style={styles.statValue}>{stats.totalMessages}</span>
          </div>
          <div style={styles.statRow}>
            <span style={styles.statKey}>Urgent Messages</span>
            <span style={{...styles.statValue, color: '#e03c3c'}}>{stats.urgentCount}</span>
          </div>
          <div style={styles.statRow}>
            <span style={styles.statKey}>Avg Hop Count</span>
            <span style={styles.statValue}>{stats.avgHopCount.toFixed(1)}</span>
          </div>
          <div style={styles.statRow}>
            <span style={styles.statKey}>Message Types</span>
            <span style={styles.statValue}>
              {Object.keys(stats.messageTypes).join(', ') || 'None'}
            </span>
          </div>
        </div>
      )}

      {/* MESSAGES CONTAINER */}
      <div style={styles.messagesContainer}>
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {loading && (
          <div style={styles.loadingBubble}>
            <div style={styles.spinner}></div>
            <span>Thinking...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* SUGGESTED QUESTIONS */}
      {messages.length <= 1 && !loading && (
        <div style={styles.suggestedSection}>
          <div style={styles.suggestedLabel}>Quick Examples — Click any question:</div>
          <div style={styles.suggestedGrid}>
            {SUGGESTED_QUESTIONS.map((question, idx) => (
              <button
                key={idx}
                onClick={() => handleSuggestedQuestion(question)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(100, 93, 234, 0.15)';
                  e.currentTarget.style.borderColor = '#645dea';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(100, 93, 234, 0.08)';
                  e.currentTarget.style.borderColor = '#2e3b7d';
                }}
                style={styles.suggestedBtn}
                title={question}
              >
                {question.length > 50 ? question.substring(0, 47) + '...' : question}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* INPUT FORM */}
      <form onSubmit={handleAsk} style={styles.form}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask questions: 'Where is food?', 'Is it safe?', 'How to treat burns?'..."
          style={styles.input}
          disabled={loading}
        />
        <button
          type="submit"
          style={{...styles.submitBtn, opacity: loading ? 0.6 : 1}}
          disabled={loading}
        >
          {loading ? '⏳' : '→'}
        </button>
      </form>
    </div>
  );
}

/**
 * Individual message bubble
 */
function MessageBubble({ message }) {
  const [showContext, setShowContext] = useState(false);

  const isUser = message.type === 'user';
  const isAssistant = message.type === 'assistant';
  const isError = message.type === 'error';
  const isSystem = message.type === 'system';

  return (
    <div style={{...styles.messageBubble, ...getMessageStyle(message.type)}}>
      <div style={styles.messageContent}>
        <div style={styles.messageText}>{message.text}</div>

        {/* SOURCES */}
        {isAssistant && message.sources && message.sources.length > 0 && (
          <div style={styles.sourcesSection}>
            <button
              onClick={() => setShowContext(!showContext)}
              style={styles.sourcesToggle}
            >
              📄 {message.sources.length} source{message.sources.length > 1 ? 's' : ''} 
              ({showContext ? '−' : '+'})
            </button>

            {showContext && (
              <div style={styles.sourcesList}>
                {message.sources.map((source) => (
                  <div key={source.id} style={styles.sourceItem}>
                    <div style={styles.sourceHeader}>
                      <span style={styles.sourceType}>{source.type}</span>
                      <span style={styles.sourceRelevance}>
                        {(source.relevance * 100).toFixed(0)}% match
                      </span>
                    </div>
                  </div>
                ))}

                {message.context && (
                  <div style={styles.contextBlock}>
                    <div style={styles.contextLabel}>Context Used</div>
                    <pre style={styles.contextText}>{message.context.slice(0, 500)}...</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function getMessageStyle(type) {
  const baseStyle = {
    marginBottom: '12px',
    wordWrap: 'break-word'
  };

  const styles = {
    user: {
      ...baseStyle,
      alignSelf: 'flex-end',
      backgroundColor: 'rgba(57, 211, 83, 0.1)',
      borderColor: '#1a6628',
      borderLeftColor: '#39d353'
    },
    assistant: {
      ...baseStyle,
      alignSelf: 'flex-start',
      backgroundColor: 'rgba(100, 125, 234, 0.1)',
      borderColor: '#2e3b7d',
      borderLeftColor: '#645dea'
    },
    error: {
      ...baseStyle,
      alignSelf: 'flex-start',
      backgroundColor: 'rgba(224, 60, 60, 0.1)',
      borderColor: '#5a1a1a',
      borderLeftColor: '#e03c3c'
    },
    system: {
      ...baseStyle,
      alignSelf: 'center',
      backgroundColor: 'rgba(100, 100, 100, 0.1)',
      borderColor: '#2e3338',
      borderLeftColor: '#6b7280'
    }
  };

  return styles[type] || styles.assistant;
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: '#0d0e0f',
    borderRadius: '4px',
    overflow: 'hidden',
    border: '1px solid #1e2124'
  },

  /* HEADER */
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px',
    borderBottom: '1px solid #1e2124',
    backgroundColor: '#161819'
  },
  title: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  titleText: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: '18px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    color: '#d4d8dc',
    textTransform: 'uppercase'
  },
  subtitle: {
    fontFamily: "'Share Tech Mono', monospace",
    fontSize: '9px',
    letterSpacing: '0.1em',
    color: '#3d4248',
    textTransform: 'uppercase'
  },
  statsBtn: {
    fontFamily: "'Share Tech Mono', monospace",
    fontSize: '14px',
    padding: '6px 10px',
    backgroundColor: 'transparent',
    border: '1px solid #2e3338',
    color: '#d4d8dc',
    cursor: 'pointer',
    transition: 'all 0.15s'
  },

  /* STATS PANEL */
  statsPanel: {
    backgroundColor: '#161819',
    borderBottom: '1px solid #1e2124',
    padding: '12px 16px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '12px'
  },
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '10px'
  },
  statKey: {
    fontFamily: "'Share Tech Mono', monospace",
    color: '#3d4248',
    textTransform: 'uppercase',
    letterSpacing: '0.08em'
  },
  statValue: {
    fontFamily: "'Share Tech Mono', monospace",
    color: '#39d353',
    fontWeight: 600
  },

  /* MESSAGES */
  messagesContainer: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  messageBubble: {
    padding: '12px 14px',
    border: '1px solid',
    borderLeft: '3px solid',
    borderRadius: '2px'
  },
  messageContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  messageText: {
    fontFamily: "'Share Tech Mono', monospace",
    fontSize: '11px',
    color: '#d4d8dc',
    lineHeight: '1.6'
  },

  /* SOURCES */
  sourcesSection: {
    marginTop: '8px'
  },
  sourcesToggle: {
    fontFamily: "'Share Tech Mono', monospace",
    fontSize: '9px',
    padding: '4px 8px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid #2e3338',
    color: '#6b7280',
    cursor: 'pointer',
    transition: 'all 0.15s',
    borderRadius: '2px',
    width: '100%',
    textAlign: 'left'
  },
  sourcesList: {
    marginTop: '8px',
    paddingTop: '8px',
    borderTop: '1px solid #1e2124'
  },
  sourceItem: {
    fontSize: '9px',
    padding: '6px',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: '2px',
    marginBottom: '4px'
  },
  sourceHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  sourceType: {
    fontFamily: "'Share Tech Mono', monospace",
    color: '#645dea',
    textTransform: 'uppercase',
    letterSpacing: '0.08em'
  },
  sourceRelevance: {
    fontFamily: "'Share Tech Mono', monospace",
    color: '#39d353'
  },
  contextBlock: {
    marginTop: '8px',
    backgroundColor: '#0d0e0f',
    border: '1px solid #2e3338',
    borderRadius: '2px',
    overflow: 'hidden'
  },
  contextLabel: {
    fontFamily: "'Share Tech Mono', monospace",
    fontSize: '8px',
    padding: '4px 6px',
    backgroundColor: '#161819',
    color: '#3d4248',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    borderBottom: '1px solid #2e3338'
  },
  contextText: {
    fontSize: '8px',
    color: '#6b7280',
    margin: 0,
    padding: '6px',
    maxHeight: '150px',
    overflow: 'auto',
    fontFamily: "'Share Tech Mono', monospace"
  },

  /* LOADING */
  loadingBubble: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 14px',
    backgroundColor: 'rgba(100, 125, 234, 0.1)',
    borderLeft: '3px solid #645dea',
    borderRadius: '2px',
    fontFamily: "'Share Tech Mono', monospace",
    fontSize: '11px',
    color: '#645dea'
  },
  spinner: {
    width: '12px',
    height: '12px',
    border: '2px solid #645dea',
    borderTop: '2px solid transparent',
    borderRadius: '50%',
    animation: 'spin 0.6s linear infinite'
  },

  /* FORM */
  form: {
    display: 'flex',
    gap: '8px',
    padding: '12px 16px',
    borderTop: '1px solid #1e2124',
    backgroundColor: '#161819'
  },
  input: {
    flex: 1,
    padding: '8px 12px',
    fontFamily: "'Share Tech Mono', monospace",
    fontSize: '11px',
    backgroundColor: '#0d0e0f',
    border: '1px solid #2e3338',
    color: '#d4d8dc',
    borderRadius: '2px',
    outline: 'none',
    transition: 'border-color 0.15s'
  },
  submitBtn: {
    padding: '8px 12px',
    fontFamily: "'Share Tech Mono', monospace",
    fontSize: '14px',
    backgroundColor: 'rgba(57, 211, 83, 0.1)',
    border: '1px solid #1a6628',
    color: '#39d353',
    cursor: 'pointer',
    borderRadius: '2px',
    transition: 'all 0.15s'
  },

  /* SUGGESTED QUESTIONS */
  suggestedSection: {
    padding: '12px 16px',
    backgroundColor: '#161819',
    borderTop: '1px solid #1e2124',
    maxHeight: '200px',
    overflowY: 'auto'
  },
  suggestedLabel: {
    fontFamily: "'Share Tech Mono', monospace",
    fontSize: '9px',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: '#3d4248',
    marginBottom: '10px'
  },
  suggestedGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '8px'
  },
  suggestedBtn: {
    padding: '8px 10px',
    fontFamily: "'Share Tech Mono', monospace",
    fontSize: '10px',
    backgroundColor: 'rgba(100, 93, 234, 0.08)',
    border: '1px solid #2e3b7d',
    color: '#645dea',
    cursor: 'pointer',
    borderRadius: '2px',
    transition: 'all 0.2s',
    textAlign: 'left',
    lineHeight: '1.4',
    outline: 'none'
  }
};
