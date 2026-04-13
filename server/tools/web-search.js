// ===== Web Search Tool — DuckDuckGo Instant Answers =====
const https = require('https');
const { registerTool } = require('./index');

registerTool({
  name: 'web_search',
  description: 'Search the web for information. Returns a summary of search results. Use this for research, fact-checking, and finding current information.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query (e.g., "best React UI component libraries 2025")',
      },
    },
    required: ['query'],
  },
  async execute(args) {
    try {
      // Use DuckDuckGo Instant Answer API (free, no key needed)
      const results = await duckDuckGoSearch(args.query);
      if (results) return results;
      return `Search completed for "${args.query}" but no instant answer was available. Try a more specific query.`;
    } catch (err) {
      return `Search error: ${err.message}`;
    }
  },
});

/**
 * DuckDuckGo Instant Answer API
 */
function duckDuckGoSearch(query) {
  return new Promise((resolve, reject) => {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

    https.get(url, { headers: { 'User-Agent': 'MissionControl/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const parts = [];

          if (json.AbstractText) {
            parts.push(`## Summary\n${json.AbstractText}`);
            if (json.AbstractURL) parts.push(`Source: ${json.AbstractURL}`);
          }

          if (json.RelatedTopics && json.RelatedTopics.length > 0) {
            parts.push('\n## Related Information');
            json.RelatedTopics.slice(0, 8).forEach(topic => {
              if (topic.Text) {
                parts.push(`- ${topic.Text}`);
                if (topic.FirstURL) parts.push(`  Link: ${topic.FirstURL}`);
              }
            });
          }

          if (json.Answer) {
            parts.push(`\n## Direct Answer\n${json.Answer}`);
          }

          if (json.Definition) {
            parts.push(`\n## Definition\n${json.Definition}`);
            if (json.DefinitionURL) parts.push(`Source: ${json.DefinitionURL}`);
          }

          resolve(parts.length > 0 ? parts.join('\n') : null);
        } catch (e) {
          reject(new Error('Failed to parse search results'));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}
