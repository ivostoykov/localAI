/**
 * Internal Tools Module
 * Provides built-in tool functions and their definitions for LLM tool calling
 */

/**
 * Calculate relative date/time from natural language offset
 * @param {string} str - Time offset string (e.g., "3 hours ago", "2 days from now")
 * @returns {Date} Calculated date object
 */
function relativeDate(str) {
    const units = {s:1e3,m:6e4,h:36e5,d:864e5,w:6048e5,mo:2592e6,y:31536e6};
    const normalized = str.trim().replace(/^in\s+/i, '');
    const matches = normalized.match(/\d+|[a-z]+/gi);
    if (!matches || matches.length < 2) {
        console.error(`>>> ${manifest?.name ?? ''} - [internal-tools.js:relativeDate] - Invalid time offset format:`, {
            input: str,
            normalized,
            matches,
            expectedFormat: 'Examples: "3d ago", "2w from now", "in 1 week", "in 2 days"'
        });
        throw new Error("Invalid time offset format");
    }
    const [n, u] = matches;
    const key = u.toLowerCase().startsWith('mo') ? 'mo' :
                u.toLowerCase().startsWith('y') ? 'y' : u[0].toLowerCase();

    if (!units[key]) {
        console.error(`>>> ${manifest?.name ?? ''} - [internal-tools.js:relativeDate] - Unknown time unit:`, {
            input: str,
            parsedUnit: u,
            parsedKey: key,
            validUnits: Object.keys(units)
        });
        throw new Error(`Unknown time unit: ${u}`);
    }

    // Check if it's "ago" (past) or "from now"/"in" (future)
    const isPast = str.toLowerCase().includes('ago');
    const multiplier = isPast ? -1 : 1;

    return new Date(Date.now() + multiplier * n * units[key]);
}

async function getAllSessionPages(tabId) {
    const sessionId = await getActiveSessionId();
    if (!sessionId) { return "No active session yet."; }

    const data = await getActiveSessionPageData(tabId);
    if (data?.pageContent && data?.pageHash) {
        const currentPage = {
            url: data.url || location.href,
            title: data.title || 'Untitled',
            content: data.pageContent,
            hash: data.pageHash,
            timestamp: Date.now()
        };
        await backgroundMemory.addPageToSession(sessionId, currentPage);
    }

    const allPages = await backgroundMemory.getSessionPages(sessionId);
    return allPages.length > 0
        ? JSON.stringify(allPages, null, 2)
        : "No pages stored in this session yet";
}

async function getLastSessionPages(count = 1, tabId) {
    const sessionId = await getActiveSessionId();
    if (!sessionId) { return "No active session yet."; }

    const data = await getActiveSessionPageData(tabId);
    if (data?.pageContent && data?.pageHash) {
        const currentPage = {
            url: data.url || location.href,
            title: data.title || 'Untitled',
            content: data.pageContent,
            hash: data.pageHash,
            timestamp: Date.now()
        };
        await backgroundMemory.addPageToSession(sessionId, currentPage);
    }

    const lastPages = await backgroundMemory.getLastSessionPages(sessionId, count);
    return lastPages.length > 0
            ? JSON.stringify(lastPages, null, 2)
            : "No pages stored in this session yet";
}

async function clearOldPageContext() {
    const sessionId = await getActiveSessionId();
    if (!sessionId) { return "No active session yet."; }

    const cleared = await backgroundMemory.clearSessionPages(sessionId);
    return cleared
            ? "All previous page content has been cleared from session history"
            : "No page content to clear";
}

async function calculateRelativeDateTimeByOffset(offset) {
    if (!offset) {  return "No time offset provided";  }

    let res;
    try {
        const result = relativeDate(offset);
        res = `The relative date/time for offset '${offset}' resolves to ${result.toISOString()}`;
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}]`, res);
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}]`, error);
        res = `Failed to calculate date/time: ${error.message}`;
    }

    return res;
}

async function getConversationTurn(turnNumber) {
    const sessionId = await getActiveSessionId();
    if (!sessionId) {
        return "No active session yet.";
    }

    const conversations = await backgroundMemory.query('conversations', 'sessionId', sessionId);
    const turn = conversations.find(c => c.turnNumber === turnNumber);

    if (!turn) {
        return `Turn ${turnNumber} not found in current session.`;
    }

    return JSON.stringify({
        turnNumber: turn.turnNumber,
        userMessage: turn.userMessage,
        assistantResponse: turn.assistantResponse,
        timestamp: new Date(turn.timestamp).toISOString()
    }, null, 2);
}

async function listRecentSessions(limit = 10) {
    const allSessions = await getAllSessions();

    if (allSessions.length === 0) {
        return "No sessions found.";
    }

    const validSessions = allSessions.filter(s => {
        const timestamp = s.lastAccessedAt ?? s.createdAt;
        return timestamp && !isNaN(new Date(timestamp).getTime());
    });

    if (validSessions.length === 0) {
        return "No valid sessions found.";
    }

    const sorted = validSessions
        .sort((a, b) => {
            const timeA = a.lastAccessedAt ?? a.createdAt ?? 0;
            const timeB = b.lastAccessedAt ?? b.createdAt ?? 0;
            return timeB - timeA;
        })
        .slice(0, limit);

    return JSON.stringify(sorted.map(s => ({
        sessionId: s.id,
        title: s.title || 'Untitled',
        lastAccessed: new Date(s.lastAccessedAt ?? s.createdAt).toISOString(),
        createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : 'Unknown'
    })), null, 2);
}

async function searchConversationHistory(args, tabId) {
    const sessionId = await getActiveSessionId();
    const scope = args.scope ?? 'current_session';
    const searchOptions = {
        sessionId: scope === 'current_session' ? sessionId : null,
        tabId: scope === 'current_tab' ? tabId : null,
        type: args.type || null,
        limit: args.limit || 10,
        threshold: args.threshold ?? 0.6
    };

    const results = await backgroundMemory.semanticSearch(args.query, searchOptions);

    if (results.length === 0) {
        return "No relevant conversation history found for this query.";
    }

    return JSON.stringify(results.map(r => ({
        similarity: r.similarity.toFixed(3),
        type: r.type,
        turnNumber: r.turnNumber,
        sessionId: r.sessionId,
        metadata: r.metadata
    })), null, 2);
}

/**
 * Execute internal tool based on tool call
 * @param {Object} call - Tool call object from LLM
 * @returns {Object} Result object with status and content
 */
async function execInternalTool(call = {}, tabId = null) {
    const funcName = call?.function?.name.toLowerCase();
    if(!funcName || !isInternalTool(funcName)){
        console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Unrecognised tool: '${funcName}'. Available:`, getInternalToolNames());
        return `${funcName} was not found!`;
    }
    let data;

    switch (funcName) {
        case "get_current_tab_url":
            data = await getActiveSessionPageData(tabId);
            return data?.url || 'No URL available';

        case "get_date":
            return new Date().toISOString().split('T')[0];

        case "get_tab_info":
            data = await getActiveSessionPageData(tabId);
            return JSON.stringify({
                url: data?.url || 'No URL available',
                content: data?.pageContent || 'No page content available'
            }, null, 2);

        case "get_current_tab_page_content":
            data = await getActiveSessionPageData(tabId);
            return data?.pageContent || 'No page content available';

        case "get_all_session_pages":
            return await getAllSessionPages(tabId);

        case "get_last_session_pages":
            return await getLastSessionPages(call?.function?.arguments?.count, tabId);

        case "clear_old_page_context":
            return await clearOldPageContext();

        case "calculate_date_time":
            return calculateRelativeDateTimeByOffset(call?.function?.arguments?.offset || call?.arguments?.offset);

        case "search_conversation_history":
            return await searchConversationHistory(call?.function?.arguments || {}, tabId);

        case "get_conversation_turn":
            return await getConversationTurn(call?.function?.arguments?.turn_number);

        case "list_recent_sessions":
            return await listRecentSessions(call?.function?.arguments?.limit);

        case "get_page_structure":
            return await callContentScriptExtractor(tabId, 'getPageStructureSummary', null);

        case "get_page_tables":
            return await callContentScriptExtractor(tabId, 'getPageTables', call?.function?.arguments?.tableIndex);

        case "get_page_lists":
            return await callContentScriptExtractor(tabId, 'getPageLists', call?.function?.arguments?.listIndex);

        case "get_page_code_blocks":
            return await callContentScriptExtractor(tabId, 'getPageCodeBlocks', call?.function?.arguments?.blockIndex);

        case "get_page_metadata":
            return await callContentScriptExtractor(tabId, 'getPageMetadataFormatted', null);

        case "get_enhanced_page_content":
            return await callContentScriptExtractor(tabId, 'getEnhancedPageContent', null);

        case "get_main_content":
            return await callContentScriptExtractor(tabId, 'getMainContentOnly', null);
    }
}

async function callContentScriptExtractor(tabId, functionName, argument = null) {
    if (!tabId) {
        return 'Error: No tab ID provided for content extraction';
    }

    try {
        const response = await chrome.tabs.sendMessage(tabId, {
            action: 'callContentExtractor',
            functionName: functionName,
            argument: argument
        });

        console.debug(`>>> ${manifest?.name ?? ''} - [internal-tools.js] - Received response:`, response);
        console.debug(`>>> ${manifest?.name ?? ''} - [internal-tools.js] - response?.result type:`, typeof response?.result, 'length:', response?.result?.length);

        if (response?.error) {
            console.error(`>>> ${manifest?.name ?? ''} - [internal-tools.js] - Content extractor error:`, response.error);
            return `Error calling ${functionName}: ${response.error}`;
        }

        return response?.result || `No result from ${functionName}`;
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [internal-tools.js] - Failed to call content extractor:`, error);
        return `Error: Could not communicate with page. The page may not support content extraction.`;
    }
}

/**
 * Internal tool definitions in MCP-compatible format
 * These are built-in tools that don't require external endpoints
 * IMMUTABLE: These cannot be modified by users via options page
 */
const INTERNAL_TOOL_DEFINITIONS = [
    {
        "function": {
            "description": "Retrieves the last N pages from the current session, where N is specified by the count parameter. Returns an array of the most recent page objects with URL, title, content, and timestamp. Useful for comparing recent pages or when the user references 'the last few pages'.",
            "name": "get_last_session_pages",
            "parameters": {
                "properties": {
                    "count": {
                        "description": "Number of recent pages to retrieve. Must be greater than 0 and not exceed the total number of pages in the session.",
                        "minimum": 1,
                        "type": "integer"
                    }
                },
                "required": ["count"],
                "type": "object"
            }
        },
        "strict": true,
        "type": "tool",
        "usage_cost": 2
    },
    {
        "function": {
            "description": "Retrieves all pages visited during the current session. Returns an array of page objects with URL, title, content, and timestamp. Useful when the user asks to compare or review multiple pages from the current browsing session.",
            "name": "get_all_session_pages",
            "parameters": {
                "properties": {},
                "required": [],
                "type": "object"
            }
        },
        "strict": true,
        "type": "tool",
        "usage_cost": 2
    },
    {
        "function": {
            "description": "Call this to get both the URL and full text content of the active browser tab. Returns tab URL and page content together. Use when you need both location and content information about the page user is viewing.",
            "name": "get_tab_info",
            "parameters": {
                "properties": {},
                "required": [],
                "type": "object"
            }
        },
        "strict": true,
        "type": "tool",
        "usage_cost": 1
    },
    {
        "function": {
            "description": "Call this whenever the user needs the current or present date **without calculation**, including any question that refers to today, now, current, right now, at the moment, this day, or the present date, even if phrased indirectly. Examples: \"What\'s today\'s date?\"; \"What date is it?\"; \"Today\'s date for a form\"; \"Current date please\"; \"As of today\". Returns the current date in ISO 8601 format (YYYY-MM-DD). **Do NOT** use for date calculations — use calculate_date_time instead.",
            "name": "get_date",
            "parameters": {
                "properties": {},
                "required": [],
                "type": "object"
            }
        },
        "strict": true,
        "type": "tool",
        "usage_cost": 1
    },
    {
        "function": {
            "description": "Call this when user asks 'what URL am I on', 'what's this page address', or you need to identify the current website. Returns only the URL of the active browser tab. If you also need page content, use get_tab_info instead.",
            "name": "get_current_tab_url",
            "parameters": {
                "properties": {},
                "required": [],
                "type": "object"
            }
        },
        "strict": true,
        "type": "tool",
        "usage_cost": 1
    },
    {
        "function": {
            "description": "Call this when user references 'current page', 'current tab', 'this page', 'this tab', 'the page', 'the tab', or any variation, including phrases like 'using the current page', 'extract from this page', 'what does this page say about'. In browser context, 'page' and 'tab' are interchangeable. Returns clean visible text content from the active browser tab including all text, data, and information visible on the page. This should satisfy most extraction requests. Only if specific data is still missing after using this tool should you call get_enhanced_page_content next. Do NOT use web_search for current page - use this instead.",
            "name": "get_current_tab_page_content",
            "parameters": {
                "properties": {},
                "required": [],
                "type": "object"
            }
        },
        "strict": true,
        "type": "tool",
        "usage_cost": 1
    },
    {
        "function": {
            "description": "Call this ONLY if get_current_tab_page_content left gaps in required information. Returns enhanced page content with preserved structure, links in [text](url) format, tables, lists, code blocks, and semantic HTML. More comprehensive than basic text extraction. If this still doesn't satisfy all requirements, call get_page_metadata as last resort.",
            "name": "get_enhanced_page_content",
            "parameters": {
                "properties": {},
                "required": [],
                "type": "object"
            }
        },
        "strict": true,
        "type": "tool",
        "usage_cost": 2
    },
    {
        "function": {
            "description": "Call this when user explicitly asks to forget, ignore, or clear previous page content. Use when user says 'forget previous data', 'ignore provided content', 'clear page history', 'forget the pages'. Removes all stored pages from session history. If user then asks about current page, call get_current_tab_page_content separately.",
            "name": "clear_old_page_context",
            "parameters": {
                "properties": {},
                "required": [],
                "type": "object"
            }
        },
        "strict": true,
        "type": "tool",
        "usage_cost": 1
    },
    {
        "function": {
            "description": "Call this tool when you encounter relative time expressions like '3 hours ago', '2 weeks ago', '1 day ago' in text and need to calculate the **actual date/time** they refer to. This converts natural-language time offsets (e.g., '5 hours ago', '3 days ago', 'in 2 weeks', '1 week ago') into precise ISO 8601 timestamps. Always use this when the user asks 'when was X published/posted/created' and the page shows relative time like '2 days ago' instead of an exact date.",
            "name": "calculate_date_time",
            "parameters": {
                "properties": {
                    "offset": {
                        "description": "Required: time duration string in natural language - e.g. '3 hours ago', '2 days from now', '30 min ago', 'in 1 week'",
                        "type": "string"
                    }
                },
                "required": ["offset"],
                "type": "object"
            }
        },
        "strict": true,
        "type": "tool"
    },
    {
        "function": {
            "description": "Searches conversation history using semantic similarity. Finds relevant past interactions based on meaning, not just keywords. Returns ranked results with similarity scores. Use when the user asks about past conversations, previous questions, or wants to recall earlier discussions.",
            "name": "search_conversation_history",
            "parameters": {
                "properties": {
                    "query": {
                        "description": "Search query - what to look for in conversation history",
                        "type": "string"
                    },
                    "scope": {
                        "description": "Search scope: 'current_session' (default), 'current_tab', or 'all_sessions'",
                        "enum": ["current_session", "current_tab", "all_sessions"],
                        "type": "string"
                    },
                    "type": {
                        "description": "Filter by message type: 'user', 'assistant', 'tool_call', or null for all types",
                        "enum": ["user", "assistant", "tool_call"],
                        "type": "string"
                    },
                    "limit": {
                        "description": "Maximum number of results to return (default: 10)",
                        "minimum": 1,
                        "maximum": 50,
                        "type": "integer"
                    },
                    "threshold": {
                        "description": "Minimum similarity score 0-1 (default: 0.6). Higher values = more strict matching",
                        "minimum": 0,
                        "maximum": 1,
                        "type": "number"
                    }
                },
                "required": ["query"],
                "type": "object"
            }
        },
        "strict": true,
        "type": "tool",
        "usage_cost": 3
    },
    {
        "function": {
            "description": "Retrieves a specific conversation turn by number from the current session. Returns the user message, assistant response, and timestamp for that turn. Use when the user asks about a specific question/answer pair, e.g., 'what did I ask in question 3' or 'show me turn 5'.",
            "name": "get_conversation_turn",
            "parameters": {
                "properties": {
                    "turn_number": {
                        "description": "Turn number to retrieve (1-based index)",
                        "minimum": 1,
                        "type": "integer"
                    }
                },
                "required": ["turn_number"],
                "type": "object"
            }
        },
        "strict": true,
        "type": "tool",
        "usage_cost": 1
    },
    {
        "function": {
            "description": "Lists recent chat sessions sorted by last access time. Returns session IDs, titles, and timestamps. Use when the user wants to find previous conversations, e.g., 'show my recent chats', 'list my sessions', 'what did we talk about yesterday'.",
            "name": "list_recent_sessions",
            "parameters": {
                "properties": {
                    "limit": {
                        "description": "Maximum number of sessions to return (default: 10)",
                        "minimum": 1,
                        "maximum": 50,
                        "type": "integer"
                    }
                },
                "required": [],
                "type": "object"
            }
        },
        "strict": true,
        "type": "tool",
        "usage_cost": 1
    },
    {
        "function": {
            "description": "Get page structure overview with metadata and element counts. Returns metadata (title, author, publish date, description) and counts of tables, lists, code blocks, images, and links. Use this when you need to understand page structure before extracting specific elements like tables or lists.",
            "name": "get_page_structure",
            "parameters": {
                "properties": {},
                "required": [],
                "type": "object"
            }
        },
        "strict": true,
        "type": "tool",
        "usage_cost": 2
    },
    {
        "function": {
            "description": "Extract tables from the current page in markdown format. Only call this if you need tabular data or the user asks about tables/data. Can extract all tables or a specific table by index. Use after get_page_structure confirms tables exist.",
            "name": "get_page_tables",
            "parameters": {
                "properties": {
                    "tableIndex": {
                        "description": "Optional: specific table index (0-based). If omitted, returns all tables.",
                        "minimum": 0,
                        "type": "integer"
                    }
                },
                "required": [],
                "type": "object"
            }
        },
        "strict": true,
        "type": "tool",
        "usage_cost": 2
    },
    {
        "function": {
            "description": "Extract lists from the current page with hierarchy preserved (nested lists). Only call this if you need list data or the user asks about lists/items/steps. Can extract all lists or a specific list by index. Works with both ordered (numbered) and unordered (bullet) lists.",
            "name": "get_page_lists",
            "parameters": {
                "properties": {
                    "listIndex": {
                        "description": "Optional: specific list index (0-based). If omitted, returns all lists.",
                        "minimum": 0,
                        "type": "integer"
                    }
                },
                "required": [],
                "type": "object"
            }
        },
        "strict": true,
        "type": "tool",
        "usage_cost": 2
    },
    {
        "function": {
            "description": "Extract code blocks from the current page with language detection. Only call this if the user asks about code, technical content, or examples. Returns code in properly formatted markdown code blocks. Can extract all code blocks or a specific one by index.",
            "name": "get_page_code_blocks",
            "parameters": {
                "properties": {
                    "blockIndex": {
                        "description": "Optional: specific code block index (0-based). If omitted, returns all code blocks.",
                        "minimum": 0,
                        "type": "integer"
                    }
                },
                "required": [],
                "type": "object"
            }
        },
        "strict": true,
        "type": "tool",
        "usage_cost": 2
    },
    {
        "function": {
            "description": "**NEVER call this first!** Only call as LAST resort if `get_current_tab_page_content` and `get_enhanced_page_content` both failed to provide required information. Use ONLY when previous tools don't provide required metadata and complimentary with `get_current_tab_page_content` first or `get_enhanced_page_content`.",
            "name": "get_page_metadata",
            "parameters": {
                "properties": {},
                "required": [],
                "type": "object"
            }
        },
        "strict": true,
        "type": "tool",
        "usage_cost": 3
    },
    {
        "function": {
            "description": "Extract only the main content area (article/blog post) without navigation, sidebars, ads, or footer. Use when user asks to summarise, analyse, or understand the main article/post. More focused than get_current_tab_page_content. If main content cannot be detected, use get_enhanced_page_content instead.",
            "name": "get_main_content",
            "parameters": {
                "properties": {},
                "required": [],
                "type": "object"
            }
        },
        "strict": true,
        "type": "tool",
        "usage_cost": 2
    }
];

/**
 * Get all internal tool names
 * @returns {string[]} Array of internal tool names
 */
function getInternalToolNames() {
    return INTERNAL_TOOL_DEFINITIONS.map(tool => tool.function.name);
}

/**
 * Check if a tool name is an internal tool
 * @param {string} toolName - Name of the tool to check
 * @returns {boolean} True if tool is internal
 */
function isInternalTool(toolName) {
    return getInternalToolNames().includes(toolName?.toLowerCase());
}
