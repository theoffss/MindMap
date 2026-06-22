import JSZip from 'jszip';
import './style.css';

// Interfaces for our mindmap structure
interface MindmapNode {
  title: string;
  topics?: MindmapNode[];
  note?: string;
  label?: string;
  _collapsed?: boolean;
}

interface MindmapSheet {
  title: string;
  topic: MindmapNode;
}

interface HistoryEntry {
  id: string;
  fileName: string;
  fileSizeText: string;
  lastModified: number;
  sheets: MindmapSheet[];
}

// Application State
const state = {
  sheets: [] as MindmapSheet[],
  fileName: "",
  fileSizeText: "",
  opmlString: "",
  activeTab: "tab-tree",
  theme: "dark",
  activeHistoryId: null as string | null
};

// Active Selection variables
let selectedNode: MindmapNode | null = null;

// Helper to find the parent of a node recursively
function findParentNode(sheets: MindmapSheet[], targetNode: MindmapNode): MindmapNode | null {
  let foundParent: MindmapNode | null = null;
  
  const traverse = (current: MindmapNode, parent: MindmapNode | null): boolean => {
    if (current === targetNode) {
      foundParent = parent;
      return true;
    }
    if (current.topics) {
      for (const child of current.topics) {
        if (traverse(child, current)) return true;
      }
    }
    return false;
  };

  for (const sheet of sheets) {
    if (traverse(sheet.topic, null)) {
      break;
    }
  }
  return foundParent;
}

// Function to select a node and populate the editor sidebar
function selectNode(node: MindmapNode) {
  selectedNode = node;
  const parentNode = findParentNode(state.sheets, node);

  // Open the sidebar
  const sidebar = document.getElementById('node-editor-sidebar');
  sidebar?.classList.remove('hide');

  // Fill in input values
  const titleInput = document.getElementById('edit-node-title') as HTMLInputElement;
  const labelInput = document.getElementById('edit-node-label') as HTMLInputElement;
  const noteTextarea = document.getElementById('edit-node-note') as HTMLTextAreaElement;
  const deleteBtn = document.getElementById('btn-delete-node') as HTMLButtonElement;

  if (titleInput) titleInput.value = node.title || "";
  if (labelInput) labelInput.value = node.label || "";
  if (noteTextarea) noteTextarea.value = node.note || "";

  // Enable/Disable delete button for the root node (no parent)
  if (deleteBtn) {
    if (!parentNode) {
      deleteBtn.disabled = true;
      deleteBtn.style.opacity = '0.5';
      deleteBtn.style.cursor = 'not-allowed';
      deleteBtn.title = "Le sujet central ne peut pas être supprimé";
    } else {
      deleteBtn.disabled = false;
      deleteBtn.style.opacity = '1';
      deleteBtn.style.cursor = 'pointer';
      deleteBtn.title = "";
    }
  }

  // Update selection highlights in the DOM instantly
  updateSelectedHighlightsInDom();
}

// Helper to update selection highlights in DOM without full rebuild
function updateSelectedHighlightsInDom() {
  // Tree highlight
  document.querySelectorAll('.tree-node-header').forEach(h => h.classList.remove('selected-node'));
  // Svg highlight
  document.querySelectorAll('.svg-node-rect').forEach(r => r.classList.remove('selected-node'));
  // Column highlight
  document.querySelectorAll('.finder-item').forEach(i => i.classList.remove('active'));
}
// Rebuild only the view of the currently active tab
function rebuildActiveView() {
  if (state.activeTab === 'tab-tree') {
    const searchInput = document.getElementById('search-nodes-input') as HTMLInputElement;
    const searchVal = searchInput ? searchInput.value : "";
    searchTree(searchVal);
  } else if (state.activeTab === 'tab-columns') {
    renderColumnBrowser(state.sheets);
  } else if (state.activeTab === 'tab-preview') {
    const previewContainer = document.getElementById('opml-code-preview');
    if (previewContainer) {
      if (state.opmlString.length > 150 * 1024) {
        const truncated = state.opmlString.substring(0, 100 * 1024) + "\n\n<!-- ... [Aperçu tronqué pour des raisons de performance. Téléchargez le fichier pour voir l'intégralité.] ... -->";
        previewContainer.innerHTML = highlightXml(truncated);
      } else {
        previewContainer.innerHTML = highlightXml(state.opmlString);
      }
    }
  } else if (state.activeTab === 'tab-visual') {
    buildSvgMindmap();
  }
}

// Function to refresh the active view with updated data model state
function refreshAllViews() {
  // Regenerate OPML String
  state.opmlString = dictToOpml(state.sheets);

  // Re-calculate stats
  const stats = getMapStats(state.sheets);
  const sheetsEl = document.getElementById('stat-sheets');
  const nodesEl = document.getElementById('stat-nodes');
  const depthEl = document.getElementById('stat-depth');
  if (sheetsEl) sheetsEl.textContent = stats.sheetsCount.toString();
  if (nodesEl) nodesEl.textContent = stats.totalNodes.toString();
  if (depthEl) depthEl.textContent = stats.maxDepth.toString();

  rebuildActiveView();
  triggerAutoSave();
}

// Depth Colors Configuration
const DEPTH_COLORS = [
  'var(--color-indigo)',  // Depth 0 (Root)
  'var(--color-blue)',    // Depth 1
  'var(--color-teal)',    // Depth 2
  'var(--color-green)',   // Depth 3
  'var(--color-amber)',   // Depth 4
  'var(--color-orange)',  // Depth 5
  'var(--color-red)'      // Depth 6+
];

function getDepthColor(depth: number): string {
  return DEPTH_COLORS[Math.min(depth, DEPTH_COLORS.length - 1)];
}

// -------------------------------------------------------------
// TOAST NOTIFICATIONS
// -------------------------------------------------------------
function showToast(message: string, type: 'success' | 'error' = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconSvg = type === 'success' 
    ? `<svg class="toast-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
    : `<svg class="toast-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;

  toast.innerHTML = iconSvg;
  const textSpan = document.createElement('span');
  textSpan.className = 'toast-text';
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  container.appendChild(toast);

  // Fade out and remove after 3s
  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 3000);
}

// -------------------------------------------------------------
// XML ENTITIES ESCAPER
// -------------------------------------------------------------
function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

// -------------------------------------------------------------
// XMIND PARSERS (JSON & XML FALLBACK)
// -------------------------------------------------------------

function parseXmindJson(jsonText: string): MindmapSheet[] {
  const sheets = JSON.parse(jsonText);
  const result: MindmapSheet[] = [];

  const parseTopic = (topicNode: any): MindmapNode => {
    const title = topicNode.title || "";
    let topics: MindmapNode[] = [];
    let note: string | undefined;
    let label: string | undefined;

    const childrenData = topicNode.children;
    let childrenList: any[] = [];
    if (childrenData) {
      if (childrenData.attached && Array.isArray(childrenData.attached)) {
        childrenList = childrenData.attached;
      } else if (Array.isArray(childrenData)) {
        childrenList = childrenData;
      }
    }

    if (childrenList.length > 0) {
      topics = childrenList.map(c => parseTopic(c));
    }

    const notesData = topicNode.notes;
    if (notesData && notesData.plain && notesData.plain.content) {
      note = notesData.plain.content;
    }

    const labelsData = topicNode.labels;
    if (labelsData && Array.isArray(labelsData) && labelsData.length > 0) {
      label = labelsData.join(", ");
    }

    const node: MindmapNode = { title };
    if (topics.length > 0) node.topics = topics;
    if (note) node.note = note;
    if (label) node.label = label;
    return node;
  };

  for (const sheet of sheets) {
    const rootTopic = sheet.rootTopic;
    if (rootTopic) {
      result.push({
        title: sheet.title || "Sheet",
        topic: parseTopic(rootTopic)
      });
    }
  }

  return result;
}

function parseXmindXml(xmlText: string): MindmapSheet[] {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");
  const sheets: MindmapSheet[] = [];

  const getLocalName = (el: Element) => el.localName || el.tagName.split(':').pop() || '';

  const parseXmlTopic = (topicEl: Element): MindmapNode => {
    let title = "";
    let topics: MindmapNode[] = [];
    let note: string | undefined;
    let label: string | undefined;

    const children = topicEl.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const name = getLocalName(child);

      if (name === "title") {
        title = child.textContent || "";
      } else if (name === "notes") {
        const plainEl = Array.from(child.children).find(c => getLocalName(c) === "plain");
        if (plainEl) {
          note = plainEl.textContent || undefined;
        }
      } else if (name === "labels") {
        const labelsList = Array.from(child.children)
          .filter(c => getLocalName(c) === "label")
          .map(c => c.textContent || "")
          .filter(t => t.length > 0);
        if (labelsList.length > 0) {
          label = labelsList.join(", ");
        }
      } else if (name === "children") {
        const topicsEls = Array.from(child.children).filter(c => getLocalName(c) === "topics");
        for (const topicsEl of topicsEls) {
          const subTopicEls = Array.from(topicsEl.children).filter(c => getLocalName(c) === "topic");
          for (const subTopicEl of subTopicEls) {
            topics.push(parseXmlTopic(subTopicEl));
          }
        }
      }
    }

    const node: MindmapNode = { title };
    if (topics.length > 0) node.topics = topics;
    if (note) node.note = note;
    if (label) node.label = label;
    return node;
  };

  const sheetEls = Array.from(xmlDoc.getElementsByTagName("*")).filter(el => getLocalName(el) === "sheet");
  for (const sheetEl of sheetEls) {
    let rootTopicEl: Element | null = null;
    let title = "Sheet";

    const children = sheetEl.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const name = getLocalName(child);
      if (name === "topic") {
        rootTopicEl = child;
      } else if (name === "title") {
        title = child.textContent || "Sheet";
      }
    }

    if (rootTopicEl) {
      sheets.push({
        title,
        topic: parseXmlTopic(rootTopicEl)
      });
    }
  }

  return sheets;
}

function parseOpmlXml(xmlText: string): MindmapSheet[] {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");
  
  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) {
    throw new Error("Erreur de parsing XML : " + parserError.textContent);
  }

  const body = xmlDoc.querySelector("body");
  if (!body) {
    throw new Error("Fichier OPML invalide : section <body> manquante.");
  }

  const outlines = Array.from(body.children).filter(el => el.tagName.toLowerCase() === "outline");
  if (outlines.length === 0) {
    throw new Error("Fichier OPML invalide : aucun élément <outline> trouvé dans le corps.");
  }

  const parseOutlineNode = (el: Element): MindmapNode => {
    const title = el.getAttribute("text") || el.getAttribute("title") || "";
    const note = el.getAttribute("_note") || el.getAttribute("description") || el.getAttribute("note") || undefined;
    const label = el.getAttribute("labels") || el.getAttribute("label") || el.getAttribute("tags") || undefined;
    
    const node: MindmapNode = {
      title,
      _collapsed: false
    };
    if (note) node.note = note;
    if (label) node.label = label;

    const children = Array.from(el.children).filter(child => child.tagName.toLowerCase() === "outline");
    if (children.length > 0) {
      node.topics = children.map(parseOutlineNode);
    }
    return node;
  };

  const sheets: MindmapSheet[] = [];

  if (outlines.length === 1) {
    const headTitle = xmlDoc.querySelector("head > title")?.textContent || "";
    const firstOutline = outlines[0];
    const topic = parseOutlineNode(firstOutline);
    sheets.push({
      title: headTitle || topic.title || "Feuille 1",
      topic: topic
    });
  } else {
    for (const sheetOutline of outlines) {
      const sheetTitle = sheetOutline.getAttribute("text") || "Feuille";
      const firstChild = Array.from(sheetOutline.children).find(el => el.tagName.toLowerCase() === "outline");
      if (firstChild) {
        sheets.push({
          title: sheetTitle,
          topic: parseOutlineNode(firstChild)
        });
      } else {
        sheets.push({
          title: sheetTitle,
          topic: parseOutlineNode(sheetOutline)
        });
      }
    }
  }

  return sheets;
}

// -------------------------------------------------------------
// OPML TRANSLATION
// -------------------------------------------------------------
function dictToOpml(sheets: MindmapSheet[]): string {
  let title = "XMind Map";
  if (sheets.length > 0) {
    title = sheets[0].topic.title || "XMind Map";
  }

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<opml version="2.0">\n`;
  xml += `  <head>\n`;
  xml += `    <title>${escapeXml(title)}</title>\n`;
  xml += `  </head>\n`;
  xml += `  <body>\n`;

  const renderNode = (node: MindmapNode, indentLevel: number): string => {
    const indent = "  ".repeat(indentLevel);
    let attrStr = `text="${escapeXml(node.title)}"`;
    if (node.note) {
      attrStr += ` _note="${escapeXml(node.note)}" description="${escapeXml(node.note)}"`;
    }
    if (node.label) {
      attrStr += ` labels="${escapeXml(node.label)}"`;
    }

    if (node.topics && node.topics.length > 0) {
      let subXml = `${indent}<outline ${attrStr}>\n`;
      for (const child of node.topics) {
        subXml += renderNode(child, indentLevel + 1);
      }
      subXml += `${indent}</outline>\n`;
      return subXml;
    } else {
      return `${indent}<outline ${attrStr}/>\n`;
    }
  };

  if (sheets.length > 1) {
    for (const sheet of sheets) {
      xml += `    <outline text="${escapeXml(sheet.title)}">\n`;
      xml += renderNode(sheet.topic, 3);
      xml += `    </outline>\n`;
    }
  } else if (sheets.length === 1) {
    xml += renderNode(sheets[0].topic, 2);
  }

  xml += `  </body>\n`;
  xml += `</opml>`;

  return xml;
}

// -------------------------------------------------------------
// STATS CALCULATION
// -------------------------------------------------------------
function getMapStats(sheets: MindmapSheet[]) {
  let totalNodes = 0;
  let maxDepth = 0;

  const traverse = (node: MindmapNode, depth: number) => {
    totalNodes++;
    maxDepth = Math.max(maxDepth, depth);
    if (node.topics) {
      for (const sub of node.topics) {
        traverse(sub, depth + 1);
      }
    }
  };

  for (const sheet of sheets) {
    traverse(sheet.topic, 1);
  }

  return {
    sheetsCount: sheets.length,
    totalNodes,
    maxDepth
  };
}

// -------------------------------------------------------------
// XML CODE HIGHLIGHTER
// -------------------------------------------------------------
function highlightXml(xml: string): string {
  let escaped = xml
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Highlight tags
  escaped = escaped.replace(/(&lt;\/?[a-zA-Z0-9_-]+)/g, '<span class="xml-tag">$1</span>');
  escaped = escaped.replace(/(\/?&gt;)/g, '<span class="xml-tag">$1</span>');

  // Highlight attribute names
  escaped = escaped.replace(/(\s[a-zA-Z0-9_-]+=)/g, '<span class="xml-attr-name">$1</span>');

  // Highlight attribute values
  escaped = escaped.replace(/(&quot;.*?&quot;)/g, '<span class="xml-attr-val">$1</span>');

  return escaped;
}

// Helper to filter sheets by search query (returns a copy of sheets with matches and their ancestors)
function getFilteredSheets(sheets: MindmapSheet[], query: string): MindmapSheet[] {
  const q = query.toLowerCase().trim();
  if (!q) return sheets;

  const filterNode = (node: MindmapNode): MindmapNode | null => {
    const isMatch = node.title.toLowerCase().includes(q);
    const filteredTopics: MindmapNode[] = [];

    if (node.topics) {
      for (const child of node.topics) {
        const filteredChild = filterNode(child);
        if (filteredChild) {
          filteredTopics.push(filteredChild);
        }
      }
    }

    if (isMatch || filteredTopics.length > 0) {
      const copy: MindmapNode = {
        title: node.title,
        note: node.note,
        label: node.label
      };
      if (filteredTopics.length > 0) {
        copy.topics = filteredTopics;
      }
      return copy;
    }
    return null;
  };

  const result: MindmapSheet[] = [];
  for (const sheet of sheets) {
    const filteredRoot = filterNode(sheet.topic);
    if (filteredRoot) {
      result.push({
        title: sheet.title,
        topic: filteredRoot
      });
    }
  }
  return result;
}

// -------------------------------------------------------------
// INTERACTIVE TREE GENERATOR (WITH LAZY RENDERING)
// -------------------------------------------------------------
function renderTree(sheets: MindmapSheet[], forceExpandAll = false, queryActive = "") {
  const container = document.getElementById('tree-container');
  if (!container) return;
  container.innerHTML = "";

  const renderNodeElement = (node: MindmapNode, depth: number): HTMLElement => {
    const nodeDiv = document.createElement('div') as any;
    
    // Use node._collapsed state, default to collapsed for depth >= 2
    const startExpanded = forceExpandAll || (node._collapsed === undefined ? depth < 2 : !node._collapsed);
    nodeDiv.className = `tree-node ${startExpanded ? 'expanded' : 'collapsed'}`;
    nodeDiv.dataset.title = node.title.toLowerCase();

    const header = document.createElement('div');
    header.className = `tree-node-header ${selectedNode === node ? 'selected-node' : ''}`;

    const hasChildren = node.topics && node.topics.length > 0;
    
    // Lazy rendering state
    let childrenRendered = false;
    let childContainer: HTMLElement | null = null;

    const renderChildrenDom = () => {
      if (childrenRendered || !hasChildren || !node.topics) return;
      
      childContainer = document.createElement('div');
      childContainer.className = 'tree-node-children-container';

      const line = document.createElement('div');
      line.className = 'tree-node-vertical-line';
      line.style.backgroundColor = getDepthColor(depth);
      childContainer.appendChild(line);

      const childrenListDiv = document.createElement('div');
      childrenListDiv.className = 'tree-node-children';
      for (const sub of node.topics) {
        childrenListDiv.appendChild(renderNodeElement(sub, depth + 1));
      }

      childContainer.appendChild(childrenListDiv);
      nodeDiv.appendChild(childContainer);
      childrenRendered = true;
    };

    // Attach reference to force lazy rendering later (e.g. Expand All)
    nodeDiv._renderChildren = renderChildrenDom;

    // Toggle Button (Arrow)
    const toggleSpan = document.createElement('span');
    toggleSpan.className = 'tree-node-toggle';
    
    if (hasChildren) {
      toggleSpan.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      `;
      
      const toggleAction = (e?: Event) => {
        if (e) e.stopPropagation();
        
        // Force rendering of children on expansion
        if (!nodeDiv.classList.contains('expanded')) {
          renderChildrenDom();
        }
        
        nodeDiv.classList.toggle('expanded');
        nodeDiv.classList.toggle('collapsed');
        node._collapsed = nodeDiv.classList.contains('collapsed');
      };

      toggleSpan.addEventListener('click', toggleAction);
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        selectNode(node);
      });
    } else {
      toggleSpan.style.opacity = '0';
      toggleSpan.style.cursor = 'default';
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        selectNode(node);
      });
    }
    header.appendChild(toggleSpan);

    // Bullet circle
    const bullet = document.createElement('span');
    bullet.className = 'tree-node-bullet';
    bullet.style.backgroundColor = getDepthColor(depth);
    header.appendChild(bullet);

    // Title text
    const titleSpan = document.createElement('span');
    titleSpan.className = 'tree-node-title';
    titleSpan.textContent = node.title || "Sans titre";
    
    // Highlight if search matches
    if (queryActive && node.title.toLowerCase().includes(queryActive.toLowerCase().trim())) {
      titleSpan.classList.add('search-highlight');
    }
    header.appendChild(titleSpan);

    // Badge tags
    if (node.label) {
      const badge = document.createElement('span');
      badge.className = 'tree-node-badge';
      badge.textContent = node.label;
      header.appendChild(badge);
    }

    // Note tooltip
    if (node.note) {
      const noteIcon = document.createElement('span');
      noteIcon.className = 'tree-node-note-icon';
      noteIcon.dataset.tooltip = node.note;
      noteIcon.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
      `;
      header.appendChild(noteIcon);
    }

    nodeDiv.appendChild(header);

    // Render immediately if startExpanded is true
    if (startExpanded) {
      renderChildrenDom();
    }

    return nodeDiv;
  };

  for (const sheet of sheets) {
    const sheetBlock = document.createElement('div');
    sheetBlock.className = 'tree-sheet-block';

    if (sheets.length > 1) {
      const sheetTitle = document.createElement('h3');
      sheetTitle.className = 'tree-sheet-title';
      sheetTitle.textContent = sheet.title;
      sheetBlock.appendChild(sheetTitle);
    }

    sheetBlock.appendChild(renderNodeElement(sheet.topic, 0));
    container.appendChild(sheetBlock);
  }
}

// Helper to expand/collapse all nodes
function setAllNodesExpanded(expanded: boolean) {
  const traverse = (node: MindmapNode) => {
    if (node.topics && node.topics.length > 0) {
      node._collapsed = !expanded;
      for (const sub of node.topics) {
        traverse(sub);
      }
    }
  };
  for (const sheet of state.sheets) {
    traverse(sheet.topic);
  }
  refreshAllViews();
}

// -------------------------------------------------------------
// SEARCH LOGIC IN TREE VIEW (OPTIMIZED)
// -------------------------------------------------------------
function searchTree(query: string) {
  const clearBtn = document.getElementById('btn-clear-search');

  if (query.trim().length > 0) {
    clearBtn?.classList.remove('hide');
    const filtered = getFilteredSheets(state.sheets, query);
    renderTree(filtered, true, query);
  } else {
    clearBtn?.classList.add('hide');
    renderTree(state.sheets, false, "");
  }
}

// -------------------------------------------------------------
// FINDER COLUMN EXPLORER
// -------------------------------------------------------------
// Helper to compute node ancestors in state hierarchy
function getNodeAncestors(node: MindmapNode): MindmapNode[] {
  const path: MindmapNode[] = [];
  let current: MindmapNode | null = node;
  while (current) {
    path.unshift(current);
    current = findParentNode(state.sheets, current);
  }
  return path;
}

// -------------------------------------------------------------
// FINDER COLUMN EXPLORER
// -------------------------------------------------------------
function renderColumnBrowser(sheets: MindmapSheet[]) {
  const browser = document.getElementById('column-browser');
  if (!browser) return;
  browser.innerHTML = "";

  const ancestors = selectedNode ? getNodeAncestors(selectedNode) : [];

  const createColumn = (title: string, node?: MindmapNode): HTMLElement => {
    const colDiv = document.createElement('div');
    colDiv.className = 'finder-column';
    
    const header = document.createElement('div');
    const isSelected = node && selectedNode === node;
    header.className = `finder-column-header ${node ? 'clickable-header' : ''} ${isSelected ? 'active-header' : ''}`;
    
    const titleSpan = document.createElement('span');
    titleSpan.className = 'column-header-title';
    titleSpan.textContent = title;
    header.appendChild(titleSpan);

    if (node) {
      const addBtn = document.createElement('button');
      addBtn.className = 'column-add-btn';
      addBtn.title = "Ajouter un sous-sujet";
      addBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      `;
      
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        
        if (!node.topics) {
          node.topics = [];
        }
        const newNode: MindmapNode = {
          title: "Nouveau sous-sujet",
          _collapsed: false
        };
        node.topics.push(newNode);
        node._collapsed = false;
        
        selectNode(newNode);
        refreshAllViews();
        
        const editTitleInput = document.getElementById('edit-node-title') as HTMLInputElement;
        editTitleInput?.focus();
        editTitleInput?.select();
      });
      
      header.appendChild(addBtn);

      header.addEventListener('click', () => {
        browser.querySelectorAll('.finder-column-header').forEach(h => h.classList.remove('active-header'));
        header.classList.add('active-header');
        selectNode(node);
      });
    }

    colDiv.appendChild(header);

    const list = document.createElement('div');
    list.className = 'finder-column-list';
    colDiv.appendChild(list);

    browser.appendChild(colDiv);
    return list;
  };

  const createItemButton = (node: MindmapNode, depth: number, isSelectedInPath: boolean, clickHandler: () => void): HTMLElement => {
    const itemBtn = document.createElement('div');
    const isActive = selectedNode === node;
    itemBtn.className = `finder-item ${isActive ? 'active' : ''} ${(!isActive && isSelectedInPath) ? 'selected-path' : ''}`;
    
    // Colored circle
    const bullet = document.createElement('span');
    bullet.className = 'finder-item-bullet';
    bullet.style.backgroundColor = getDepthColor(depth);
    itemBtn.appendChild(bullet);

    // Title
    const titleSpan = document.createElement('span');
    titleSpan.className = 'finder-item-title';
    titleSpan.textContent = node.title || "Sans titre";
    itemBtn.appendChild(titleSpan);

    // Note icon indicator
    if (node.note) {
      const noteIcon = document.createElement('span');
      noteIcon.className = 'finder-item-icon-note';
      noteIcon.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
      `;
      itemBtn.appendChild(noteIcon);
    }

    // Chevron if has subtopics
    const hasChildren = node.topics && node.topics.length > 0;
    if (hasChildren) {
      const chevron = document.createElement('span');
      chevron.className = 'finder-item-chevron';
      chevron.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      `;
      itemBtn.appendChild(chevron);
    }

    itemBtn.addEventListener('click', () => {
      // Clear active and selected-path in current list
      const siblings = itemBtn.parentElement?.children;
      if (siblings) {
        Array.from(siblings).forEach(s => {
          s.classList.remove('active');
          s.classList.remove('selected-path');
        });
      }
      itemBtn.classList.add('active');
      
      // Select for editing
      selectNode(node);
      
      clickHandler();
    });

    return itemBtn;
  };

  const centerActiveColumn = (colIndex: number) => {
    const columns = browser.querySelectorAll('.finder-column');
    if (columns[colIndex]) {
      const colEl = columns[colIndex] as HTMLElement;
      const browserWidth = browser.clientWidth;
      
      const rectParent = browser.getBoundingClientRect();
      const rectCol = colEl.getBoundingClientRect();
      const colLeft = rectCol.left - rectParent.left + browser.scrollLeft;
      const colWidth = rectCol.width;
      
      // Target scroll position to center the column
      const targetScroll = colLeft - (browserWidth / 2) + (colWidth / 2);
      
      browser.scrollTo({
        left: targetScroll,
        behavior: 'smooth'
      });
    }
  };

  const showSubTopics = (node: MindmapNode, parentColIndex: number, currentDepth: number) => {
    // Remove all columns to the right of parent column
    const columns = browser.querySelectorAll('.finder-column');
    for (let i = parentColIndex + 1; i < columns.length; i++) {
      columns[i].remove();
    }

    const hasChildren = node.topics && node.topics.length > 0;

    if (hasChildren && node.topics) {
      const subList = createColumn(node.title, node);
      for (const sub of node.topics) {
        const subColIndex = parentColIndex + 1;
        const subInPath = ancestors.includes(sub) || selectedNode === sub;
        const btn = createItemButton(sub, currentDepth + 1, subInPath, () => {
          showSubTopics(sub, subColIndex, currentDepth + 1);
        });
        subList.appendChild(btn);
      }
    } else if (node.note) {
      // Leaf node but has a note: render a details column
      const detailColDiv = document.createElement('div');
      detailColDiv.className = 'finder-column finder-detail-column';
      
      const title = document.createElement('h3');
      title.className = 'finder-detail-title';
      title.textContent = node.title;
      detailColDiv.appendChild(title);

      if (node.label) {
        const badge = document.createElement('span');
        badge.className = 'finder-detail-label-badge';
        badge.textContent = node.label;
        detailColDiv.appendChild(badge);
      }

      const noteTitle = document.createElement('h4');
      noteTitle.className = 'finder-detail-section-title';
      noteTitle.textContent = "NOTES / DÉTAILS";
      detailColDiv.appendChild(noteTitle);

      const noteBox = document.createElement('div');
      noteBox.className = 'finder-detail-note';
      noteBox.textContent = node.note;
      detailColDiv.appendChild(noteBox);

      browser.appendChild(detailColDiv);
    }

    // Center active column
    centerActiveColumn(parentColIndex + 1);
  };

  // Start with Column 0 and draw initial ancestor path columns recursively
  if (sheets.length > 1) {
    const list = createColumn("Feuilles / Cartes");
    sheets.forEach((sheet) => {
      const inPath = ancestors.includes(sheet.topic) || selectedNode === sheet.topic;
      const btn = createItemButton(sheet.topic, 0, inPath, () => {
        showSubTopics(sheet.topic, 0, 0);
      });
      list.appendChild(btn);
    });

    // Recursively draw subsequent columns for ancestors in the path
    let currentColIdx = 0;
    for (let i = 0; i < ancestors.length; i++) {
      const node = ancestors[i];
      const hasChildren = node.topics && node.topics.length > 0;
      
      if (hasChildren && node.topics) {
        const nextColIndex = currentColIdx + 1;
        const subList = createColumn(node.title, node);
        for (const sub of node.topics) {
          const inPath = ancestors.includes(sub) || selectedNode === sub;
          const btn = createItemButton(sub, i + 1, inPath, () => {
            showSubTopics(sub, nextColIndex, i + 1);
          });
          subList.appendChild(btn);
        }
        currentColIdx++;
      } else if (node.note) {
        const detailColDiv = document.createElement('div');
        detailColDiv.className = 'finder-column finder-detail-column';
        
        const title = document.createElement('h3');
        title.className = 'finder-detail-title';
        title.textContent = node.title;
        detailColDiv.appendChild(title);

        if (node.label) {
          const badge = document.createElement('span');
          badge.className = 'finder-detail-label-badge';
          badge.textContent = node.label;
          detailColDiv.appendChild(badge);
        }

        const noteTitle = document.createElement('h4');
        noteTitle.className = 'finder-detail-section-title';
        noteTitle.textContent = "NOTES / DÉTAILS";
        detailColDiv.appendChild(noteTitle);

        const noteBox = document.createElement('div');
        noteBox.className = 'finder-detail-note';
        noteBox.textContent = node.note;
        detailColDiv.appendChild(noteBox);

        browser.appendChild(detailColDiv);
        currentColIdx++;
      }
    }
  } else if (sheets.length === 1) {
    const rootTopic = sheets[0].topic;
    const list = createColumn(rootTopic.title || "Sujet Central", rootTopic);
    
    if (rootTopic.topics && rootTopic.topics.length > 0) {
      for (const child of rootTopic.topics) {
        const inPath = ancestors.includes(child) || selectedNode === child;
        const btn = createItemButton(child, 1, inPath, () => {
          showSubTopics(child, 0, 1);
        });
        list.appendChild(btn);
      }
    } else {
      const emptyText = document.createElement('span');
      emptyText.style.padding = '12px';
      emptyText.style.fontSize = '0.8rem';
      emptyText.style.color = 'var(--text-tertiary)';
      emptyText.style.fontStyle = 'italic';
      emptyText.textContent = "Aucun sous-sujet";
      list.appendChild(emptyText);
    }

    // Draw subsequent columns based on path
    let currentColIdx = 0;
    const rootIdx = ancestors.indexOf(rootTopic);
    if (rootIdx !== -1) {
      for (let i = rootIdx + 1; i < ancestors.length; i++) {
        const node = ancestors[i];
        const hasChildren = node.topics && node.topics.length > 0;
        
        if (hasChildren && node.topics) {
          const nextColIndex = currentColIdx + 1;
          const subList = createColumn(node.title, node);
          for (const sub of node.topics) {
            const inPath = ancestors.includes(sub) || selectedNode === sub;
            const btn = createItemButton(sub, i, inPath, () => {
              showSubTopics(sub, nextColIndex, i);
            });
            subList.appendChild(btn);
          }
          currentColIdx++;
        } else if (node.note) {
          const detailColDiv = document.createElement('div');
          detailColDiv.className = 'finder-column finder-detail-column';
          
          const title = document.createElement('h3');
          title.className = 'finder-detail-title';
          title.textContent = node.title;
          detailColDiv.appendChild(title);

          if (node.label) {
            const badge = document.createElement('span');
            badge.className = 'finder-detail-label-badge';
            badge.textContent = node.label;
            detailColDiv.appendChild(badge);
          }

          const noteTitle = document.createElement('h4');
          noteTitle.className = 'finder-detail-section-title';
          noteTitle.textContent = "NOTES / DÉTAILS";
          detailColDiv.appendChild(noteTitle);

          const noteBox = document.createElement('div');
          noteBox.className = 'finder-detail-note';
          noteBox.textContent = node.note;
          detailColDiv.appendChild(noteBox);

          browser.appendChild(detailColDiv);
          currentColIdx++;
        }
      }
    }
  }

  // After drawing everything, scroll to center the last column
  const columns = browser.querySelectorAll('.finder-column');
  if (columns.length > 0) {
    setTimeout(() => {
      centerActiveColumn(columns.length - 1);
    }, 50);
  }
}

// -------------------------------------------------------------
// LOCALSTORAGE HISTORY MANAGER
// -------------------------------------------------------------
function getHistory(): HistoryEntry[] {
  try {
    const data = localStorage.getItem('xmind_to_opml_history');
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error("Error reading history from localStorage:", e);
    return [];
  }
}

function writeHistoryToLocalStorage(history: HistoryEntry[]) {
  let success = false;
  let attempts = 0;
  while (!success && history.length > 0 && attempts < 10) {
    try {
      localStorage.setItem('xmind_to_opml_history', JSON.stringify(history));
      success = true;
    } catch (e) {
      console.warn("localStorage quota exceeded, removing oldest history item.");
      history.pop();
      attempts++;
    }
  }
}

function saveCurrentToHistory() {
  if (state.sheets.length === 0) return;
  
  if (!state.activeHistoryId) {
    state.activeHistoryId = Date.now().toString() + "_" + Math.random().toString(36).substr(2, 9);
  }

  const entry: HistoryEntry = {
    id: state.activeHistoryId,
    fileName: state.fileName,
    fileSizeText: state.fileSizeText,
    lastModified: Date.now(),
    sheets: state.sheets
  };

  let history = getHistory();
  const index = history.findIndex(h => h.id === entry.id);

  if (index !== -1) {
    history[index] = entry;
  } else {
    history.unshift(entry);
  }

  history.sort((a, b) => b.lastModified - a.lastModified);

  if (history.length > 10) {
    history = history.slice(0, 10);
  }

  writeHistoryToLocalStorage(history);
  renderHistoryList();
}

function deleteHistoryEntry(id: string, e: Event) {
  e.stopPropagation();
  if (confirm("Voulez-vous vraiment supprimer cette carte de l'historique ?")) {
    let history = getHistory();
    history = history.filter(h => h.id !== id);
    writeHistoryToLocalStorage(history);
    
    if (state.activeHistoryId === id) {
      state.activeHistoryId = null;
    }
    
    renderHistoryList();
    showToast("Carte supprimée de l'historique.");
  }
}

function loadHistoryEntry(entry: HistoryEntry) {
  state.fileName = entry.fileName;
  state.fileSizeText = entry.fileSizeText;
  state.sheets = entry.sheets;
  state.opmlString = dictToOpml(entry.sheets);
  state.activeHistoryId = entry.id;

  document.getElementById('loaded-file-name')!.textContent = state.fileName;
  document.getElementById('loaded-file-size')!.textContent = state.fileSizeText;

  const stats = getMapStats(state.sheets);
  document.getElementById('stat-sheets')!.textContent = stats.sheetsCount.toString();
  document.getElementById('stat-nodes')!.textContent = stats.totalNodes.toString();
  document.getElementById('stat-depth')!.textContent = stats.maxDepth.toString();

  const searchInput = document.getElementById('search-nodes-input') as HTMLInputElement;
  if (searchInput) searchInput.value = "";

  document.getElementById('upload-zone')!.classList.add('hide');
  document.getElementById('workspace-zone')!.classList.remove('hide');

  rebuildActiveView();
  showToast(`Carte "${state.fileName}" restaurée !`);
}

function renderHistoryList() {
  const historySection = document.getElementById('history-section');
  const historyList = document.getElementById('history-list');
  if (!historyList) return;

  const history = getHistory();
  if (history.length === 0) {
    historySection?.classList.add('hide');
    return;
  }

  historySection?.classList.remove('hide');
  historyList.innerHTML = "";

  history.forEach(entry => {
    const isOpml = entry.fileName.toLowerCase().endsWith('.opml');
    const badgeText = isOpml ? 'OPML' : 'XMIND';
    const badgeClass = isOpml ? 'badge-opml' : 'badge-xmind';
    
    const dateStr = new Date(entry.lastModified).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    const escapedFileName = escapeXml(entry.fileName);
    const displayName = entry.fileName.replace(/\.(xmind|opml)$/i, '');
    const escapedDisplayName = escapeXml(displayName);
    const escapedFileSizeText = escapeXml(entry.fileSizeText);

    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML = `
      <button class="history-card-delete" title="Supprimer de l'historique">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <div class="history-card-info">
        <h4 class="history-card-title" title="${escapedFileName}">${escapedDisplayName}</h4>
      </div>
      <div class="history-card-meta">
        <span class="history-card-date">${dateStr}</span>
        <div class="history-card-badge-row">
          <span class="history-card-badge ${badgeClass}">${badgeText}</span>
          <span class="history-card-date">${escapedFileSizeText}</span>
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      loadHistoryEntry(entry);
    });

    const deleteBtn = card.querySelector('.history-card-delete');
    deleteBtn?.addEventListener('click', (e) => {
      deleteHistoryEntry(entry.id, e);
    });

    historyList.appendChild(card);
  });
}

let autoSaveTimeout: any = null;
function triggerAutoSave() {
  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout);
  }
  autoSaveTimeout = setTimeout(() => {
    saveCurrentToHistory();
  }, 1000);
}

// -------------------------------------------------------------
// CORE XMIND LOADER
// -------------------------------------------------------------
async function loadFile(file: File) {
  const overlay = document.getElementById('loading-overlay');
  overlay?.classList.remove('hide');
  
  // Allow browser to render the loading overlay before starting zip/parsing CPU-heavy tasks
  await new Promise(resolve => setTimeout(resolve, 50));

  try {
    state.fileName = file.name;
    state.fileSizeText = `${(file.size / 1024).toFixed(1)} KB`;
    state.activeHistoryId = Date.now().toString() + "_" + Math.random().toString(36).substr(2, 9);

    const percentText = document.getElementById('loading-percentage');
    if (percentText) percentText.textContent = "Lecture du fichier...";

    let parsedSheets: MindmapSheet[] = [];

    if (file.name.toLowerCase().endsWith('.opml')) {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });
      if (percentText) percentText.textContent = "Analyse de la structure OPML...";
      parsedSheets = parseOpmlXml(text);
    } else {
      if (percentText) percentText.textContent = "Lecture de l'archive XMind...";
      // 1. Unzip headers using JSZip
      const zip = await JSZip.loadAsync(file);
      const jsonFile = zip.file("content.json");
      
      if (jsonFile) {
        // Modern XMind (content.json)
        const text = await jsonFile.async("string", (metadata: any) => {
          if (percentText) {
            percentText.textContent = `Extraction : ${metadata.percent.toFixed(0)}%`;
          }
        });
        if (percentText) percentText.textContent = "Analyse de la structure...";
        parsedSheets = parseXmindJson(text);
      } else {
        const xmlFile = zip.file("content.xml");
        if (xmlFile) {
          // Classic XMind (content.xml)
          const text = await xmlFile.async("string", (metadata: any) => {
            if (percentText) {
              percentText.textContent = `Extraction : ${metadata.percent.toFixed(0)}%`;
            }
          });
          if (percentText) percentText.textContent = "Analyse de la structure...";
          parsedSheets = parseXmindXml(text);
        } else {
          throw new Error("Format XMind non pris en charge : ni content.json ni content.xml n'ont été trouvés dans l'archive.");
        }
      }
    }

    if (parsedSheets.length === 0) {
      throw new Error("Aucune feuille ou carte mentale valide n'a pu être extraite.");
    }

    // 2. Update state
    state.sheets = parsedSheets;
    state.opmlString = dictToOpml(parsedSheets);

    // 3. Compute stats
    const stats = getMapStats(parsedSheets);
    
    // 4. Update UI
    document.getElementById('loaded-file-name')!.textContent = state.fileName;
    document.getElementById('loaded-file-size')!.textContent = state.fileSizeText;
    document.getElementById('stat-sheets')!.textContent = stats.sheetsCount.toString();
    document.getElementById('stat-nodes')!.textContent = stats.totalNodes.toString();
    document.getElementById('stat-depth')!.textContent = stats.maxDepth.toString();

    // Rebuild active view
    rebuildActiveView();

    // Toggle Visibility
    document.getElementById('upload-zone')!.classList.add('hide');
    document.getElementById('workspace-zone')!.classList.remove('hide');

    // Save to history immediately
    saveCurrentToHistory();

    showToast(`Fichier "${state.fileName}" chargé avec succès !`);
  } catch (error: any) {
    showToast(error.message || "Erreur de chargement du fichier", 'error');
    console.error(error);
  } finally {
    overlay?.classList.add('hide');
  }
}

// -------------------------------------------------------------
// EXPORT OPML DOWNLOAD
// -------------------------------------------------------------
function downloadOpml() {
  if (!state.opmlString) {
    showToast("Aucune donnée OPML à exporter", 'error');
    return;
  }

  const defaultName = state.fileName.replace(".xmind", ".opml") || "mindmap.opml";
  const blob = new Blob([state.opmlString], { type: "text/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.href = url;
  link.download = defaultName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast(`Fichier exporté sous le nom de : ${defaultName}`);
}

// -------------------------------------------------------------
// INTERACTIVE GRAPHICAL MINDMAP VIEWER (SVG CANVAS)
// -------------------------------------------------------------
let svgPanX = 150;
let svgPanY = 300;
let svgZoom = 1;
let svgDragActive = false;
let svgDragStartX = 0;
let svgDragStartY = 0;

interface SvgLayoutNode {
  title: string;
  note?: string;
  label?: string;
  topics?: SvgLayoutNode[];
  _collapsed?: boolean;
  _x?: number;
  _y?: number;
  _width?: number;
  _height?: number;
  _depth?: number;
}

// Compute Y heights recursively
function computeSvgSubtreeHeight(node: SvgLayoutNode): number {
  const hasChildren = node.topics && node.topics.length > 0;
  if (!hasChildren || node._collapsed) {
    return 60; // Height allocated for leaf node
  }
  let total = 0;
  for (const child of node.topics!) {
    total += computeSvgSubtreeHeight(child);
  }
  return Math.max(total, 60);
}

// Compute positions recursively
function layoutSvgMindmap(node: SvgLayoutNode, depth: number, startX: number, centerY: number, horizontalSpacing = 240) {
  const w = Math.max(130, Math.min(220, node.title.length * 8 + 32));
  node._x = startX;
  node._y = centerY;
  node._width = w;
  node._height = 34;
  node._depth = depth;

  const hasChildren = node.topics && node.topics.length > 0;
  if (hasChildren && !node._collapsed) {
    const children = node.topics!;
    const heights = children.map(c => computeSvgSubtreeHeight(c));
    const totalHeight = heights.reduce((a, b) => a + b, 0);

    let currentY = centerY - totalHeight / 2;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childH = heights[i];
      const childCenterY = currentY + childH / 2;
      layoutSvgMindmap(child, depth + 1, startX + horizontalSpacing, childCenterY, horizontalSpacing);
      currentY += childH;
    }
  }
}

// Apply SVG Viewport translate/scale transformations
function updateSvgViewport() {
  const viewport = document.getElementById('mindmap-viewport');
  if (viewport) {
    viewport.setAttribute('transform', `translate(${svgPanX}, ${svgPanY}) scale(${svgZoom})`);
  }
}

// Rebuild the SVG graphics from state
function buildSvgMindmap() {
  const viewport = document.getElementById('mindmap-viewport');
  if (!viewport || state.sheets.length === 0) return;
  viewport.innerHTML = "";

  // Set default collapsed state for deep nodes if not set yet
  const initCollapsed = (node: SvgLayoutNode, depth: number) => {
    if (node._collapsed === undefined) {
      node._collapsed = depth >= 2;
    }
    if (node.topics) {
      for (const sub of node.topics) {
        initCollapsed(sub, depth + 1);
      }
    }
  };

  for (const sheet of state.sheets) {
    initCollapsed(sheet.topic, 0);
  }

  // Multi-sheet spacing
  let currentSheetCenterY = 0;
  const sheetHeights = state.sheets.map(s => computeSvgSubtreeHeight(s.topic));

  state.sheets.forEach((sheet, idx) => {
    const topic = sheet.topic as SvgLayoutNode;
    
    // Position multiple sheets vertically spaced
    if (idx > 0) {
      currentSheetCenterY += (sheetHeights[idx - 1] + sheetHeights[idx]) * 0.5 + 80;
    }
    
    layoutSvgMindmap(topic, 0, 50, currentSheetCenterY);

    const drawNodeGroup = (n: SvgLayoutNode) => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'svg-node-group');
      
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        selectNode(n as MindmapNode);
      });
      
      const x = n._x!;
      const y = n._y!;
      const w = n._width!;
      const h = n._height!;
      const depth = n._depth!;
      const hasChildren = n.topics && n.topics.length > 0;

      // 1. Draw Rect
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('class', `svg-node-rect ${selectedNode === n ? 'selected-node' : ''}`);
      rect.setAttribute('x', x.toString());
      rect.setAttribute('y', (y - h/2).toString());
      rect.setAttribute('width', w.toString());
      rect.setAttribute('height', h.toString());
      rect.setAttribute('rx', '8');
      rect.setAttribute('ry', '8');

      // Theme styling depending on depth
      if (depth === 0) {
        rect.setAttribute('fill', 'var(--color-primary)');
        rect.setAttribute('stroke', 'none');
      } else {
        rect.setAttribute('fill', 'var(--bg-surface)');
        rect.setAttribute('stroke', getDepthColor(depth));
        rect.setAttribute('stroke-width', '1.5');
      }
      g.appendChild(rect);

      // 2. Draw Title Text
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('class', `svg-node-text ${depth === 0 ? 'root' : ''}`);
      text.setAttribute('x', (x + 12).toString());
      text.setAttribute('y', y.toString());
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('alignment-baseline', 'middle');
      
      if (depth === 0) {
        text.setAttribute('fill', '#ffffff');
      } else {
        text.setAttribute('fill', 'var(--text-primary)');
      }

      // Truncate text if too long
      let titleText = n.title;
      if (titleText.length > 18) {
        titleText = titleText.substring(0, 16) + "...";
      }
      text.textContent = titleText;
      g.appendChild(text);

      // 3. Optional Tag Badge / Note indicator
      if (n.note) {
        // Draw a tiny amber dot/icon on the top-right
        const noteDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        noteDot.setAttribute('cx', (x + w - 10).toString());
        noteDot.setAttribute('cy', (y - h/2).toString());
        noteDot.setAttribute('r', '4');
        noteDot.setAttribute('fill', 'var(--color-amber)');
        
        const titleTooltip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        titleTooltip.textContent = n.note;
        noteDot.appendChild(titleTooltip);
        g.appendChild(noteDot);
      }

      // 4. Toggle Button for children (+ / -)
      if (hasChildren) {
        const toggleBtn = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        toggleBtn.setAttribute('class', 'svg-node-toggle-btn');
        
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', (x + w).toString());
        circle.setAttribute('cy', y.toString());
        circle.setAttribute('r', '7');
        toggleBtn.appendChild(circle);

        // Horizontal line
        const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line1.setAttribute('x1', (x + w - 4).toString());
        line1.setAttribute('y1', y.toString());
        line1.setAttribute('x2', (x + w + 4).toString());
        line1.setAttribute('y2', y.toString());
        toggleBtn.appendChild(line1);

        // Vertical line (only if collapsed)
        if (n._collapsed) {
          const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line2.setAttribute('x1', (x + w).toString());
          line2.setAttribute('y1', (y - 4).toString());
          line2.setAttribute('x2', (x + w).toString());
          line2.setAttribute('y2', (y + 4).toString());
          toggleBtn.appendChild(line2);
        }

        toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          n._collapsed = !n._collapsed;
          buildSvgMindmap();
        });

        g.appendChild(toggleBtn);
      }

      viewport.appendChild(g);

      // Draw children and connectors
      if (hasChildren && !n._collapsed) {
        n.topics!.forEach(child => {
          const px = x + w;
          const py = y;
          const cx = child._x!;
          const cy = child._y!;

          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('class', 'svg-connector');
          
          const ctrlX = (px + cx) / 2;
          const d = `M ${px} ${py} C ${ctrlX} ${py}, ${ctrlX} ${cy}, ${cx} ${cy}`;
          
          path.setAttribute('d', d);
          path.setAttribute('fill', 'none');
          path.setAttribute('stroke', getDepthColor(depth));
          path.setAttribute('stroke-width', '1.5');
          viewport.appendChild(path);

          drawNodeGroup(child);
        });
      }
    };

    drawNodeGroup(topic);
  });
}

// Center the mindmap in the SVG container
function centerSvgMindmap() {
  const container = document.querySelector('.mindmap-canvas-container');
  if (!container || state.sheets.length === 0) return;

  const w = container.clientWidth;
  const h = container.clientHeight;

  // Find bounds of all nodes
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  const getBounds = (n: SvgLayoutNode) => {
    const x = n._x!;
    const y = n._y!;
    const nw = n._width!;
    const nh = n._height!;

    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + nw);
    minY = Math.min(minY, y - nh/2);
    maxY = Math.max(maxY, y + nh/2);

    if (n.topics && !n._collapsed) {
      n.topics.forEach(getBounds);
    }
  };

  state.sheets.forEach(sheet => getBounds(sheet.topic as SvgLayoutNode));

  const boundsW = maxX - minX;
  const boundsH = maxY - minY;

  const padding = 60;
  const scaleX = (w - padding * 2) / boundsW;
  const scaleY = (h - padding * 2) / boundsH;
  
  svgZoom = Math.max(0.4, Math.min(1.5, Math.min(scaleX, scaleY)));

  svgPanX = (w - boundsW * svgZoom) / 2 - minX * svgZoom;
  svgPanY = (h - boundsH * svgZoom) / 2 - minY * svgZoom;

  updateSvgViewport();
}

// -------------------------------------------------------------
// EVENT HANDLERS & INITIALIZATION
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Render history list from localStorage if any entries exist
  renderHistoryList();

  // Flush pending auto-saves immediately if the user closes/reloads the page
  window.addEventListener('beforeunload', () => {
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
      saveCurrentToHistory();
    }
  });

  // Theme Switching
  const html = document.documentElement;
  const themeBtn = document.getElementById('theme-toggle-btn');
  const storedTheme = localStorage.getItem('theme') || 'dark';
  state.theme = storedTheme;
  html.setAttribute('data-theme', storedTheme);

  themeBtn?.addEventListener('click', () => {
    const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
    state.theme = nextTheme;
    html.setAttribute('data-theme', nextTheme);
    localStorage.setItem('theme', nextTheme);
  });

  // Drag and Drop Zone
  const uploadCard = document.querySelector('.upload-card');
  const fileInput = document.getElementById('file-input') as HTMLInputElement;

  uploadCard?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('#btn-new-map-upload')) return;
    if (fileInput) fileInput.click();
  });

  uploadCard?.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadCard.classList.add('drag-over');
  });

  uploadCard?.addEventListener('dragleave', () => {
    uploadCard.classList.remove('drag-over');
  });

  uploadCard?.addEventListener('drop', (e: any) => {
    e.preventDefault();
    uploadCard.classList.remove('drag-over');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      loadFile(files[0]);
    }
  });

  fileInput?.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      loadFile(fileInput.files[0]);
    }
  });

  // Change File Button
  document.getElementById('btn-change-file')?.addEventListener('click', () => {
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
    }
    saveCurrentToHistory();

    if (fileInput) fileInput.value = "";
    document.getElementById('workspace-zone')!.classList.add('hide');
    document.getElementById('upload-zone')!.classList.remove('hide');
    renderHistoryList();
  });

  // Save and Close Button
  document.getElementById('btn-save-close')?.addEventListener('click', () => {
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
    }
    saveCurrentToHistory();

    if (fileInput) fileInput.value = "";
    document.getElementById('workspace-zone')!.classList.add('hide');
    document.getElementById('upload-zone')!.classList.remove('hide');
    renderHistoryList();

    showToast("Carte enregistrée et fermée.");
  });

  // Export OPML Button
  document.getElementById('btn-export-opml')?.addEventListener('click', downloadOpml);

  // Tabs Switches
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      if (!targetTab) return;

      // Update buttons active class
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update panels active class
      const panels = document.querySelectorAll('.tab-panel');
      panels.forEach(p => p.classList.remove('active'));
      document.getElementById(targetTab)?.classList.add('active');

      state.activeTab = targetTab;

      // Rebuild the newly active tab view
      rebuildActiveView();

      // Center visual mindmap when visual tab is selected
      if (targetTab === 'tab-visual') {
        setTimeout(() => {
          centerSvgMindmap();
        }, 50);
      }
    });
  });

  // Copy OPML XML button
  document.getElementById('btn-copy-opml')?.addEventListener('click', () => {
    if (!state.opmlString) return;
    navigator.clipboard.writeText(state.opmlString).then(() => {
      showToast("Contenu XML copié dans le presse-papiers !");
    }).catch(err => {
      showToast("Impossible de copier dans le presse-papiers", 'error');
      console.error(err);
    });
  });

  // Search input tree view
  const searchInput = document.getElementById('search-nodes-input') as HTMLInputElement;
  const clearSearchBtn = document.getElementById('btn-clear-search');

  searchInput?.addEventListener('input', () => {
    searchTree(searchInput.value);
  });

  clearSearchBtn?.addEventListener('click', () => {
    if (searchInput) {
      searchInput.value = "";
      searchTree("");
    }
  });

  // Expand / Collapse buttons
  document.getElementById('btn-expand-all')?.addEventListener('click', () => {
    setAllNodesExpanded(true);
  });

  document.getElementById('btn-collapse-all')?.addEventListener('click', () => {
    setAllNodesExpanded(false);
  });

  // Graphical Mindmap SVG Panning / Zooming Events
  const canvasContainer = document.querySelector('.mindmap-canvas-container');
  const svg = document.getElementById('mindmap-svg');

  canvasContainer?.addEventListener('mousedown', (e: any) => {
    const target = e.target as SVGElement;
    if (target.closest('.svg-node-group')) return; // Ignore drag starting on nodes

    svgDragActive = true;
    svgDragStartX = e.clientX - svgPanX;
    svgDragStartY = e.clientY - svgPanY;
  });

  window.addEventListener('mousemove', (e: any) => {
    if (svgDragActive) {
      svgPanX = e.clientX - svgDragStartX;
      svgPanY = e.clientY - svgDragStartY;
      updateSvgViewport();
    }
  });

  window.addEventListener('mouseup', () => {
    svgDragActive = false;
  });

  svg?.addEventListener('wheel', (e: any) => {
    e.preventDefault();
    const zoomIntensity = 0.08;
    
    const rect = svg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const svgX = (mouseX - svgPanX) / svgZoom;
    const svgY = (mouseY - svgPanY) / svgZoom;

    const wheelVal = e.deltaY;
    if (wheelVal < 0) {
      svgZoom = Math.min(2.0, svgZoom * (1 + zoomIntensity));
    } else {
      svgZoom = Math.max(0.3, svgZoom * (1 - zoomIntensity));
    }

    svgPanX = mouseX - svgX * svgZoom;
    svgPanY = mouseY - svgY * svgZoom;

    updateSvgViewport();
  }, { passive: false });

  // Mindmap SVG Center Button
  document.getElementById('btn-center-mindmap')?.addEventListener('click', () => {
    centerSvgMindmap();
  });

  // Sidebar Editor Controls
  const editTitleInput = document.getElementById('edit-node-title') as HTMLInputElement;
  const editLabelInput = document.getElementById('edit-node-label') as HTMLInputElement;
  const editNoteTextarea = document.getElementById('edit-node-note') as HTMLTextAreaElement;

  editTitleInput?.addEventListener('input', () => {
    if (selectedNode) {
      selectedNode.title = editTitleInput.value;
      refreshAllViews();
    }
  });

  editLabelInput?.addEventListener('input', () => {
    if (selectedNode) {
      if (editLabelInput.value.trim() === "") {
        delete selectedNode.label;
      } else {
        selectedNode.label = editLabelInput.value;
      }
      refreshAllViews();
    }
  });

  editNoteTextarea?.addEventListener('input', () => {
    if (selectedNode) {
      if (editNoteTextarea.value.trim() === "") {
        delete selectedNode.note;
      } else {
        selectedNode.note = editNoteTextarea.value;
      }
      refreshAllViews();
    }
  });

  document.getElementById('btn-close-editor')?.addEventListener('click', () => {
    document.getElementById('node-editor-sidebar')?.classList.add('hide');
    selectedNode = null;
    // Clear selection highlights
    document.querySelectorAll('.tree-node-header').forEach(h => h.classList.remove('selected-node'));
    document.querySelectorAll('.svg-node-rect').forEach(r => r.classList.remove('selected-node'));
    document.querySelectorAll('.finder-item').forEach(i => i.classList.remove('active'));
  });

  // Add subtopic (branch)
  document.getElementById('btn-add-subtopic')?.addEventListener('click', () => {
    if (!selectedNode) return;
    if (!selectedNode.topics) {
      selectedNode.topics = [];
    }
    const newNode: MindmapNode = {
      title: "Nouveau sous-sujet",
      _collapsed: false
    };
    selectedNode.topics.push(newNode);
    selectedNode._collapsed = false; // Expand parent so we can see the child
    
    // Select new node
    selectNode(newNode);
    
    // Refresh all views
    refreshAllViews();

    // Focus editor input
    editTitleInput?.focus();
    editTitleInput?.select();
  });

  // Delete node (branch)
  document.getElementById('btn-delete-node')?.addEventListener('click', () => {
    if (!selectedNode) return;
    const parentNode = findParentNode(state.sheets, selectedNode);
    if (!parentNode) {
      showToast("Impossible de supprimer le sujet central de la feuille", "error");
      return;
    }

    if (parentNode.topics) {
      const idx = parentNode.topics.indexOf(selectedNode);
      if (idx !== -1) {
        parentNode.topics.splice(idx, 1);
        if (parentNode.topics.length === 0) {
          delete parentNode.topics;
        }

        // Select the parent node
        selectNode(parentNode);

        // Refresh all views
        refreshAllViews();
        showToast("Sujet supprimé avec succès !");
      }
    }
  });

  // Nouvelle Carte Logic
  const createNewMap = () => {
    state.activeHistoryId = Date.now().toString() + "_" + Math.random().toString(36).substr(2, 9);
    state.sheets = [{
      title: "Nouvelle Carte",
      topic: {
        title: "Sujet Central",
        _collapsed: false
      }
    }];
    state.fileName = "nouvelle_carte.xmind";
    state.fileSizeText = "0 KB";
    state.opmlString = dictToOpml(state.sheets);

    // Update UI
    document.getElementById('loaded-file-name')!.textContent = state.fileName;
    document.getElementById('loaded-file-size')!.textContent = state.fileSizeText;

    // Update Stats
    const stats = getMapStats(state.sheets);
    document.getElementById('stat-sheets')!.textContent = stats.sheetsCount.toString();
    document.getElementById('stat-nodes')!.textContent = stats.totalNodes.toString();
    document.getElementById('stat-depth')!.textContent = stats.maxDepth.toString();

    // Toggle Panels
    document.getElementById('upload-zone')!.classList.add('hide');
    document.getElementById('workspace-zone')!.classList.remove('hide');

    // Reset search
    if (searchInput) searchInput.value = "";

    // Auto-select central topic
    selectNode(state.sheets[0].topic);

    // Rebuild views
    refreshAllViews();

    // Save to history immediately
    saveCurrentToHistory();

    showToast("Nouvelle carte vide créée !");
  };

  document.getElementById('btn-new-map')?.addEventListener('click', createNewMap);
  document.getElementById('btn-new-map-upload')?.addEventListener('click', createNewMap);
});
