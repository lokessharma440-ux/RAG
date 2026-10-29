import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import './MarkdownContent.css';

/**
 * Safely render TeX using KaTeX.
 * Returns rendered HTML or falls back to raw string on error.
 */
function renderKatexToString(tex, isBlock = false) {
  if (!tex || typeof tex !== 'string') return '';
  try {
    return katex.renderToString(tex.trim(), {
      displayMode: isBlock,
      throwOnError: false,
      output: 'htmlAndMathml',
    });
  } catch (err) {
    console.warn('[KaTeX Render Warning]', err);
    return tex;
  }
}

/**
 * Enhanced Markdown parser for AI responses:
 * - Block math ($$...$$ and \[...\])
 * - Inline math ($...$ and \(...\))
 * - Code blocks (```lang ... ```) with Copy button
 * - Tables (| col | col |)
 * - Blockquotes (> quote)
 * - Headings (### H3, ## H2, # H1)
 * - Bullet lists (- item, * item) and Numbered lists (1. item)
 * - Inline formatting (**bold**, *italic*, `code`, [link](url))
 */
export default function MarkdownContent({ content }) {
  if (!content) return null;

  // Split content into code blocks, display math blocks, and regular text
  // 1. ```lang\ncode```
  // 2. $$math$$
  // 3. \[math\]
  const blockRegex = /(?:```([a-zA-Z0-9_-]*)\n([\s\S]*?)```)|(?:\$\$([\s\S]*?)\$\$)|(?:\\\[([\s\S]*?)\\\])/g;
  const tokens = [];
  let lastIndex = 0;
  let match;

  while ((match = blockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        type: 'text',
        value: content.slice(lastIndex, match.index),
      });
    }

    if (match[2] !== undefined) {
      // Code Block
      tokens.push({
        type: 'codeblock',
        lang: match[1]?.trim() || 'plaintext',
        code: match[2]?.replace(/\n$/, '') || '',
      });
    } else if (match[3] !== undefined) {
      // $$ ... $$ Math Block
      tokens.push({
        type: 'mathblock',
        tex: match[3],
      });
    } else if (match[4] !== undefined) {
      // \[ ... \] Math Block
      tokens.push({
        type: 'mathblock',
        tex: match[4],
      });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    tokens.push({
      type: 'text',
      value: content.slice(lastIndex),
    });
  }

  return (
    <div className="dev-markdown">
      {tokens.map((token, tIdx) => {
        if (token.type === 'codeblock') {
          return <CodeBlock key={tIdx} lang={token.lang} code={token.code} />;
        }
        if (token.type === 'mathblock') {
          return <MathBlock key={tIdx} tex={token.tex} />;
        }
        return <TextBlock key={tIdx} text={token.value} />;
      })}
    </div>
  );
}

function MathBlock({ tex }) {
  const html = renderKatexToString(tex, true);
  return (
    <div className="dev-math-block-wrapper">
      <div
        className="dev-math-block"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function CodeBlock({ lang, code }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="dev-code-block-wrapper">
      <div className="dev-code-block-header">
        <span className="dev-code-lang-tag">{lang}</span>
        <button
          type="button"
          className="dev-code-copy-btn"
          onClick={handleCopy}
          title="Copy code"
        >
          {copied ? (
            <>
              <Check size={12} className="text-emerald" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="dev-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function TextBlock({ text }) {
  const lines = text.split('\n');
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Table detection: starts with | and next line has |-
    if (line.trim().startsWith('|') && i + 1 < lines.length && lines[i + 1].includes('|-')) {
      const tableLines = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(<MarkdownTable key={`table-${i}`} lines={tableLines} />);
      continue;
    }

    // Blockquote
    if (line.trim().startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      elements.push(
        <blockquote key={`quote-${i}`} className="dev-markdown-blockquote">
          {quoteLines.map((ql, qIdx) => (
            <p key={qIdx}>{renderInline(ql)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Headings
    if (line.startsWith('### ')) {
      elements.push(<h4 key={`h3-${i}`} className="dev-markdown-h3">{renderInline(line.slice(4))}</h4>);
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(<h3 key={`h2-${i}`} className="dev-markdown-h2">{renderInline(line.slice(3))}</h3>);
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      elements.push(<h2 key={`h1-${i}`} className="dev-markdown-h1">{renderInline(line.slice(2))}</h2>);
      i++;
      continue;
    }

    // Unordered List
    if (/^\s*[-*]\s+/.test(line)) {
      const listItems = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="dev-markdown-ul">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered List
    if (/^\s*\d+\.\s+/.test(line)) {
      const listItems = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="dev-markdown-ol">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Regular Paragraph
    const paraLines = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('#') &&
      !lines[i].trim().startsWith('>') &&
      !lines[i].trim().startsWith('|') &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }

    elements.push(
      <p key={`p-${i}`} className="dev-markdown-p">
        {paraLines.map((pl, pIdx) => (
          <React.Fragment key={pIdx}>
            {renderInline(pl)}
            {pIdx < paraLines.length - 1 && <br />}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return <>{elements}</>;
}

function MarkdownTable({ lines }) {
  if (lines.length < 2) return null;
  const headerCells = lines[0]
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());

  const rowLines = lines.slice(2);
  const rows = rowLines.map((r) =>
    r
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())
  );

  return (
    <div className="dev-table-responsive-wrapper">
      <table className="dev-markdown-table">
        <thead>
          <tr>
            {headerCells.map((h, hIdx) => (
              <th key={hIdx}>{renderInline(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rIdx) => (
            <tr key={rIdx}>
              {row.map((cell, cIdx) => (
                <td key={cIdx}>{renderInline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Parses inline formatting:
 * - Inline math ($...$ and \(...\))
 * - **bold**
 * - *italic*
 * - `code`
 * - [text](url)
 */
function renderInline(str) {
  if (!str) return '';

  // Inline regex matches:
  // 1. Math: $(?!\s)([^$\n]+?)(?<!\s)$ OR \(([\s\S]+?)\)
  // 2. Bold: \*\*(.+?)\*\*
  // 3. Italic: \*(.+?)\*
  // 4. Code: `([^`]+)`
  // 5. Link: \[([^\]]+)\]\(([^)]+)\)
  const regex = /(\$(?!\s)[^$\n]+?(?<!\s)\$)|(?:\\\(([\s\S]+?)\\\))|(\*\*.*?\*\*)|(\*.*?\*)|(`.*?`)|(\[[^\]]+\]\([^)]+\))/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(str)) !== null) {
    if (match.index > lastIndex) {
      parts.push(str.slice(lastIndex, match.index));
    }

    const token = match[0];

    if (match[1]) {
      // $...$ inline math
      const mathContent = token.slice(1, -1);
      const html = renderKatexToString(mathContent, false);
      parts.push(
        <span
          key={`math-${match.index}`}
          className="dev-katex-inline"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    } else if (match[2]) {
      // \(...\) inline math
      const mathContent = match[2];
      const html = renderKatexToString(mathContent, false);
      parts.push(
        <span
          key={`math-p-${match.index}`}
          className="dev-katex-inline"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      // **bold**
      parts.push(<strong key={`b-${match.index}`}>{renderInline(token.slice(2, -2))}</strong>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      // *italic*
      parts.push(<em key={`i-${match.index}`}>{renderInline(token.slice(1, -1))}</em>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      // `code`
      parts.push(<code key={`c-${match.index}`} className="dev-inline-code">{token.slice(1, -1)}</code>);
    } else if (token.startsWith('[') && token.includes('](')) {
      // [text](url)
      const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        parts.push(
          <a
            key={`a-${match.index}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="dev-markdown-link"
          >
            {linkMatch[1]}
          </a>
        );
      } else {
        parts.push(token);
      }
    } else {
      parts.push(token);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < str.length) {
    parts.push(str.slice(lastIndex));
  }

  return parts;
}
