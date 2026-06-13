const fs = require('fs');

const doc = fs.readFileSync('/home/suryaguru/StudioProjects/CRM/HMS/hms_v2/api-documentation.md', 'utf8');
const lines = doc.split('\n');

const issues = [];
let currentEndpoint = null;
let inResponses = false;
let currentStatus = null;
let jsonBuffer = [];
let inJson = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  if (line.startsWith('### `')) {
    currentEndpoint = line.trim();
    inResponses = false;
    currentStatus = null;
  }
  
  if (line.startsWith('**Responses:**')) {
    inResponses = true;
  }
  
  if (inResponses && line.match(/^- \*\*Status `\d+`\*\*/)) {
    currentStatus = line.match(/\d+/)[0];
  }
  
  if (inResponses && currentStatus && line.trim() === '```json') {
    inJson = true;
    jsonBuffer = [];
    continue;
  }
  
  if (inJson && line.trim() === '```') {
    inJson = false;
    // Check JSON validity
    const jsonStr = jsonBuffer.join('\n');
    try {
      JSON.parse(jsonStr);
    } catch (e) {
      issues.push(`Invalid JSON at ${currentEndpoint} [${currentStatus}]: ${e.message}`);
    }
    
    // Check for empty brackets that indicate missing type defs
    if (jsonStr.includes('"{}"') || (jsonStr.includes('{}') && !jsonStr.includes('"testMapping": {}'))) {
       issues.push(`Empty object {} found in JSON at ${currentEndpoint} [${currentStatus}]`);
    }
  } else if (inJson) {
    jsonBuffer.push(line);
  }
}

// Check for missing Response sections entirely
const endpoints = doc.match(/### `.*?`/g) || [];
for (const ep of endpoints) {
  const idx = doc.indexOf(ep);
  const nextIdx = doc.indexOf('### `', idx + 1);
  const section = nextIdx === -1 ? doc.slice(idx) : doc.slice(idx, nextIdx);
  
  if (!section.includes('**Responses:**')) {
    issues.push(`Missing Responses section: ${ep}`);
  }
  if (!section.includes('- **Status')) {
    issues.push(`Missing Status code in Responses: ${ep}`);
  }
}

console.log(JSON.stringify(issues, null, 2));
