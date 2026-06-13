const fs = require('fs');
const path = require('path');

const swaggerPath = path.join(__dirname, 'swagger.json');
const outputPath = path.join(__dirname, 'api-documentation.md');

if (!fs.existsSync(swaggerPath)) {
  console.error('Error: swagger.json not found. Run curl first.');
  process.exit(1);
}

const swagger = JSON.parse(fs.readFileSync(swaggerPath, 'utf8'));

// Fallback schema mapping for endpoints without documented response schemas in Swagger
const fallbackSchemaMap = [
  { path: /^\/api\/auth\/login$/, method: 'POST', schema: 'TokenResponseDto' },
  { path: /^\/api\/auth\/refresh$/, method: 'POST', schema: 'TokenResponseDto' },
  
  { path: /^\/api\/users$/, method: 'GET', schema: 'UserResponseDto', isArray: true },
  { path: /^\/api\/users\/[^\/]+$/, method: 'GET', schema: 'UserResponseDto' },
  { path: /^\/api\/users$/, method: 'POST', schema: 'UserResponseDto' },
  { path: /^\/api\/users\/[^\/]+$/, method: 'PUT', schema: 'UserResponseDto' },
  
  { path: /^\/api\/patients$/, method: 'GET', schema: 'PatientResponseDto', isArray: true, isPaginated: true },
  { path: /^\/api\/patients\/[^\/]+$/, method: 'GET', schema: 'PatientResponseDto' },
  { path: /^\/api\/patients$/, method: 'POST', schema: 'PatientResponseDto' },
  { path: /^\/api\/patients\/[^\/]+$/, method: 'PUT', schema: 'PatientResponseDto' },
  
  { path: /^\/api\/appointments$/, method: 'GET', schema: 'AppointmentResponseDto', isArray: true, isPaginated: true },
  { path: /^\/api\/appointments\/[^\/]+$/, method: 'GET', schema: 'AppointmentResponseDto' },
  { path: /^\/api\/appointments$/, method: 'POST', schema: 'AppointmentResponseDto' },
  { path: /^\/api\/appointments\/[^\/]+$/, method: 'PATCH', schema: 'AppointmentResponseDto' },
  
  { path: /^\/api\/consultations$/, method: 'GET', schema: 'ConsultationResponseDto', isArray: true, isPaginated: true },
  { path: /^\/api\/consultations\/[^\/]+$/, method: 'GET', schema: 'ConsultationResponseDto' },
  { path: /^\/api\/consultations$/, method: 'POST', schema: 'ConsultationResponseDto' },
  { path: /^\/api\/consultations\/[^\/]+$/, method: 'PATCH', schema: 'ConsultationResponseDto' },

  { path: /^\/api\/billing\/invoices$/, method: 'GET', schema: 'CreateInvoiceDto', isArray: true },
  { path: /^\/api\/billing\/services$/, method: 'GET', schema: 'CreateBillingServiceDto', isArray: true },
  { path: /^\/api\/billing\/payments$/, method: 'GET', schema: 'CreatePaymentDto', isArray: true },
  
  { path: /^\/api\/inpatient\/wards$/, method: 'GET', schema: 'WardResponseDto', isArray: true },
  { path: /^\/api\/inpatient\/wards\/[^\/]+$/, method: 'GET', schema: 'WardResponseDto' },
  { path: /^\/api\/inpatient\/wards$/, method: 'POST', schema: 'WardResponseDto' },
  
  { path: /^\/api\/inpatient\/beds$/, method: 'GET', schema: 'BedResponseDto', isArray: true },
  { path: /^\/api\/inpatient\/beds\/[^\/]+$/, method: 'GET', schema: 'BedResponseDto' },
  { path: /^\/api\/inpatient\/beds$/, method: 'POST', schema: 'BedResponseDto' },
  
  { path: /^\/api\/inpatient\/admissions$/, method: 'GET', schema: 'AdmissionResponseDto', isArray: true },
  { path: /^\/api\/inpatient\/admissions\/[^\/]+$/, method: 'GET', schema: 'AdmissionResponseDto' },
  { path: /^\/api\/inpatient\/admissions$/, method: 'POST', schema: 'AdmissionResponseDto' },

  { path: /^\/api\/laboratory\/tests$/, method: 'GET', schema: 'LabTestResponseDto', isArray: true },
  { path: /^\/api\/laboratory\/tests\/[^\/]+$/, method: 'GET', schema: 'LabTestResponseDto' },
  { path: /^\/api\/laboratory\/tests$/, method: 'POST', schema: 'LabTestResponseDto' },

  { path: /^\/api\/laboratory\/orders$/, method: 'GET', schema: 'LabOrderResponseDto', isArray: true },
  { path: /^\/api\/laboratory\/orders\/[^\/]+$/, method: 'GET', schema: 'LabOrderResponseDto' },
  { path: /^\/api\/laboratory\/orders$/, method: 'POST', schema: 'LabOrderResponseDto' },

  { path: /^\/api\/laboratory\/results$/, method: 'GET', schema: 'LabResultResponseDto', isArray: true },
  { path: /^\/api\/laboratory\/results\/[^\/]+$/, method: 'GET', schema: 'LabResultResponseDto' },
  { path: /^\/api\/laboratory\/results$/, method: 'POST', schema: 'LabResultResponseDto' },

  { path: /^\/api\/pharmacy\/drugs$/, method: 'GET', schema: 'PharmacyDrugResponseDto', isArray: true },
  { path: /^\/api\/pharmacy\/drugs\/[^\/]+$/, method: 'GET', schema: 'PharmacyDrugResponseDto' },
  { path: /^\/api\/pharmacy\/drugs$/, method: 'POST', schema: 'PharmacyDrugResponseDto' },

  { path: /^\/api\/pharmacy\/prescriptions$/, method: 'GET', schema: 'PrescriptionResponseDto', isArray: true },
  { path: /^\/api\/pharmacy\/prescriptions\/[^\/]+$/, method: 'GET', schema: 'PrescriptionResponseDto' },
  { path: /^\/api\/pharmacy\/prescriptions$/, method: 'POST', schema: 'PrescriptionResponseDto' },

  { path: /^\/api\/pharmacy\/sales$/, method: 'GET', schema: 'PharmacySaleResponseDto', isArray: true },
  { path: /^\/api\/pharmacy\/sales\/[^\/]+$/, method: 'GET', schema: 'PharmacySaleResponseDto' },
  { path: /^\/api\/pharmacy\/sales$/, method: 'POST', schema: 'PharmacySaleResponseDto' },

  { path: /^\/api\/pre-triage$/, method: 'GET', schema: 'PreTriageResponseDto', isArray: true, isPaginated: true },
  { path: /^\/api\/pre-triage\/[^\/]+$/, method: 'GET', schema: 'PreTriageResponseDto' },
  { path: /^\/api\/pre-triage$/, method: 'POST', schema: 'PreTriageResponseDto' },
  { path: /^\/api\/pre-triage\/[^\/]+$/, method: 'PATCH', schema: 'PreTriageResponseDto' },

  { path: /^\/api\/queue$/, method: 'GET', schema: 'QueueResponseDto', isArray: true },
  { path: /^\/api\/queue\/[^\/]+$/, method: 'GET', schema: 'QueueResponseDto' },
  { path: /^\/api\/queue$/, method: 'POST', schema: 'QueueResponseDto' },
  { path: /^\/api\/queue\/[^\/]+$/, method: 'PATCH', schema: 'QueueResponseDto' },

  { path: /^\/api\/radiology\/exams$/, method: 'GET', schema: 'RadiologyExamResponseDto', isArray: true },
  { path: /^\/api\/radiology\/exams\/[^\/]+$/, method: 'GET', schema: 'RadiologyExamResponseDto' },
  { path: /^\/api\/radiology\/exams$/, method: 'POST', schema: 'RadiologyExamResponseDto' },

  { path: /^\/api\/radiology\/orders$/, method: 'GET', schema: 'RadiologyOrderResponseDto', isArray: true },
  { path: /^\/api\/radiology\/orders\/[^\/]+$/, method: 'GET', schema: 'RadiologyOrderResponseDto' },
  { path: /^\/api\/radiology\/orders$/, method: 'POST', schema: 'RadiologyOrderResponseDto' },

  { path: /^\/api\/radiology\/reports$/, method: 'GET', schema: 'RadiologyReportResponseDto', isArray: true },
  { path: /^\/api\/radiology\/reports\/[^\/]+$/, method: 'GET', schema: 'RadiologyReportResponseDto' },
  { path: /^\/api\/radiology\/reports$/, method: 'POST', schema: 'RadiologyReportResponseDto' },

  { path: /^\/api\/death-certificates$/, method: 'GET', schema: 'CreateDeathCertificateDto', isArray: true, isPaginated: true },
  { path: /^\/api\/death-certificates\/[^\/]+$/, method: 'GET', schema: 'CreateDeathCertificateDto' },
  { path: /^\/api\/death-certificates$/, method: 'POST', schema: 'CreateDeathCertificateDto' },

  { path: /^\/api\/dashboard$/, method: 'GET', schema: 'DashboardResponseDto' },
];

// Helper to resolve schemas recursively
function resolveSchema(schema, components) {
  if (!schema) return null;
  
  if (schema.$ref) {
    const refName = schema.$ref.replace('#/components/schemas/', '');
    const resolved = components.schemas[refName];
    if (!resolved) return { type: 'object', properties: {} };
    // Mixin the ref name so we know which schema it is
    return { ...resolved, _refName: refName };
  }
  
  if (schema.type === 'array' && schema.items) {
    const itemsResolved = resolveSchema(schema.items, components);
    return {
      type: 'array',
      items: itemsResolved,
      description: schema.description || itemsResolved.description
    };
  }
  
  return schema;
}

// Helper to format schema into a readable properties list
function formatSchemaProperties(schema, components, indent = '') {
  const resolved = resolveSchema(schema, components);
  if (!resolved) return 'No payload required.\n';
  
  if (resolved.type === 'array') {
    return `${indent}- Array of:\n${formatSchemaProperties(resolved.items, components, indent + '  ')}`;
  }
  
  if (resolved.properties) {
    let output = '';
    const required = resolved.required || [];
    
    for (const [key, prop] of Object.entries(resolved.properties)) {
      const isRequired = required.includes(key);
      const propResolved = resolveSchema(prop, components);
      const typeStr = (propResolved.type || 'string') + (propResolved.format ? ` (${propResolved.format})` : '') + (propResolved.enum ? ` [enum: ${propResolved.enum.join(', ')}]` : '');
      const desc = propResolved.description || '';
      const example = propResolved.example !== undefined ? ` (e.g. \`${JSON.stringify(propResolved.example)}\`)` : '';
      
      output += `${indent}- **\`${key}\`** (${isRequired ? 'Required' : 'Optional'}, *${typeStr}*): ${desc}${example}\n`;
      
      if (propResolved.properties) {
        output += formatSchemaProperties(propResolved, components, indent + '  ');
      } else if (propResolved.type === 'array' && propResolved.items) {
        const itemResolved = resolveSchema(propResolved.items, components);
        if (itemResolved.properties) {
          output += `${indent}  - Items properties:\n`;
          output += formatSchemaProperties(itemResolved, components, indent + '    ');
        }
      }
    }
    return output;
  }
  
  return `${indent}- *${resolved.type || 'any'}*\n`;
}

// Generate JSON example from schema
function generateExample(schema, components) {
  const resolved = resolveSchema(schema, components);
  if (!resolved) return null;
  
  if (resolved.example !== undefined) return resolved.example;
  
  if (resolved.type === 'array') {
    const itemExample = generateExample(resolved.items, components);
    return itemExample !== null ? [itemExample] : [];
  }
  
  if (resolved.type === 'object' || resolved.properties) {
    const example = {};
    for (const [key, prop] of Object.entries(resolved.properties || {})) {
      const propResolved = resolveSchema(prop, components);
      if (propResolved.example !== undefined) {
        example[key] = propResolved.example;
      } else if (propResolved.type === 'array') {
        const itemEx = generateExample(propResolved.items, components);
        example[key] = itemEx !== null ? [itemEx] : [];
      } else if (propResolved.type === 'object') {
        example[key] = generateExample(propResolved, components);
      } else {
        // Fallback placeholder values
        switch (propResolved.type) {
          case 'string':
            example[key] = propResolved.format === 'date-time' ? new Date().toISOString() : 'string';
            break;
          case 'number':
          case 'integer':
            example[key] = 0;
            break;
          case 'boolean':
            example[key] = false;
            break;
          default:
            example[key] = null;
        }
      }
    }
    return example;
  }
  
  return null;
}

// Group paths by tags
const groups = {};

for (const [p, methods] of Object.entries(swagger.paths)) {
  for (const [method, detail] of Object.entries(methods)) {
    // skip common options or invalid methods
    if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue;
    
    const tag = (detail.tags && detail.tags[0]) || 'Other';
    if (!groups[tag]) groups[tag] = [];
    
    groups[tag].push({
      path: p,
      method: method.toUpperCase(),
      ...detail
    });
  }
}

let doc = `# HMS v2 REST API Documentation

This document contains a comprehensive, highly-structured API specification for HMS v2. It includes query parameters, headers, request body structure, and responses for every endpoint.

---

## Global Context & Headers

All endpoints (except those marked \`@Public\`) require JWT authentication.

### Authentication Header
\`\`\`http
Authorization: Bearer <accessToken>
\`\`\`

### Common Response Envelope
Every API response follows a consistent JSON envelope:
\`\`\`json
{
  "success": true,
  "data": { ... },
  "message": "Optional message details",
  "errorCode": null,
  "timestamp": "2026-06-13T21:54:00.000Z",
  "path": "/api/..."
}
\`\`\`
In case of error, \`success\` is \`false\`, \`data\` is \`null\` or omitted, and \`errorCode\` and \`message\` are populated.

---

`;

// Order tags logically
const tagOrder = [
  'Authentication',
  'Users',
  'Patients',
  'Appointments',
  'Billing',
  'Consultations',
  'Inpatient',
  'Laboratory',
  'Pharmacy',
  'Radiology',
  'Queue',
  'Pre-Triage',
  'Death Certificates',
  'Settings',
  'Health'
];

const sortedTags = Object.keys(groups).sort((a, b) => {
  const indexA = tagOrder.indexOf(a);
  const indexB = tagOrder.indexOf(b);
  if (indexA === -1 && indexB === -1) return a.localeCompare(b);
  if (indexA === -1) return 1;
  if (indexB === -1) return -1;
  return indexA - indexB;
});

for (const tag of sortedTags) {
  doc += `## 📦 ${tag} Module\n\n`;
  
  const endpoints = groups[tag];
  // Sort endpoints: GET first, then POST, then PUT/PATCH, then DELETE, and then by path
  endpoints.sort((a, b) => {
    const order = { GET: 1, POST: 2, PUT: 3, PATCH: 4, DELETE: 5 };
    if (order[a.method] !== order[b.method]) {
      return order[a.method] - order[b.method];
    }
    return a.path.localeCompare(b.path);
  });
  
  for (const ep of endpoints) {
    doc += `### \`${ep.method} ${ep.path}\`\n\n`;
    doc += `**Purpose:** ${ep.summary || ep.description || 'No description provided.'}\n\n`;
    
    // Auth requirement check
    const isPublic = ep.security ? ep.security.length === 0 : false;
    doc += `* **Authentication Required:** ${isPublic ? '❌ No (Public)' : '✅ Yes'}\n`;
    
    // Path / Query Parameters
    const pathParams = (ep.parameters || []).filter(param => param.in === 'path');
    const queryParams = (ep.parameters || []).filter(param => param.in === 'query');
    
    if (pathParams.length > 0) {
      doc += `\n**Path Parameters:**\n`;
      pathParams.forEach(param => {
        doc += `- \`${param.name}\` (${param.required ? 'Required' : 'Optional'}): ${param.description || ''} *(type: ${param.schema?.type || 'string'})*\n`;
      });
    }
    
    if (queryParams.length > 0) {
      doc += `\n**Query Parameters:**\n`;
      queryParams.forEach(param => {
        const typeStr = param.schema?.type || 'string';
        const defaultVal = param.schema?.default !== undefined ? ` (default: \`${param.schema.default}\`)` : '';
        doc += `- \`${param.name}\` (${param.required ? 'Required' : 'Optional'}): ${param.description || ''} *(type: ${typeStr})${defaultVal}*\n`;
      });
    }
    
    // Request Body
    if (ep.requestBody) {
      doc += `\n**Request Body:**\n\n`;
      const content = ep.requestBody.content?.['application/json'] || ep.requestBody.content?.['multipart/form-data'];
      if (content && content.schema) {
        doc += formatSchemaProperties(content.schema, swagger.components);
        
        const example = generateExample(content.schema, swagger.components);
        if (example) {
          doc += `\n**Request Example:**\n\`\`\`json\n${JSON.stringify(example, null, 2)}\n\`\`\`\n`;
        }
      } else {
        doc += `*Raw upload / payload required.*\n`;
      }
    } else {
      doc += `\n**Request Body:** None.\n`;
    }
    
    // Responses
    doc += `\n**Responses:**\n\n`;
    for (const [code, resp] of Object.entries(ep.responses)) {
      doc += `- **Status \`${code}\`**: ${resp.description || ''}\n`;
      const respContent = resp.content?.['application/json'];
      
      let respSchema = null;
      let isFallback = false;
      let match = null;
      
      if (respContent && respContent.schema) {
        respSchema = respContent.schema;
      } else if (code === '200' || code === '201') {
        // Find matching fallback schema
        match = fallbackSchemaMap.find(m => m.path.test(ep.path) && m.method === ep.method);
        if (match) {
          respSchema = { $ref: `#/components/schemas/${match.schema}` };
          isFallback = true;
        }
      }
      
      if (respSchema) {
        let respDataExample = generateExample(respSchema, swagger.components);
        if (respDataExample) {
          // Apply fallback transformations (array or pagination wrapping)
          if (isFallback && match) {
            if (match.isPaginated) {
              respDataExample = {
                data: [respDataExample],
                meta: {
                  total: 100,
                  lastPage: 10,
                  currentPage: 1,
                  perPage: 10,
                  prev: null,
                  next: 2
                }
              };
            } else if (match.isArray) {
              respDataExample = [respDataExample];
            }
          }
          
          // Wrap in common envelope if not already wrapped
          const hasEnvelope = respDataExample && respDataExample.success !== undefined && respDataExample.data !== undefined;
          let fullEnvelope = respDataExample;
          if (!hasEnvelope) {
            fullEnvelope = {
              success: parseInt(code) >= 200 && parseInt(code) < 300,
              data: respDataExample,
              message: null,
              errorCode: null,
              timestamp: new Date().toISOString()
            };
          }
          doc += `  \`\`\`json\n${JSON.stringify(fullEnvelope, null, 2)}\n  \`\`\`\n`;
        }
      }
    }
    
    doc += `\n---\n\n`;
  }
}

fs.writeFileSync(outputPath, doc, 'utf8');
console.log('✅ api-documentation.md generated successfully.');
