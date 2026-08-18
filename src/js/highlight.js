// Syntax highlighting helpers for the workflow preview.

export function highlightMarkdown(md) {
  var lines = md.split('\n');
  var inFrontmatter = false;
  var result = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var escaped = escapeHtml(line);

    if (line === '---' && (i === 0 || inFrontmatter)) {
      inFrontmatter = !inFrontmatter;
      result.push('<span class="yaml-delim">' + escaped + '</span>');
      continue;
    }

    if (inFrontmatter) {
      result.push(highlightYamlLine(escaped));
    } else if (/^#{1,6}\s/.test(line)) {
      result.push('<span class="md-heading">' + escaped + '</span>');
    } else if (/^\d+\.\s/.test(line)) {
      var num = escaped.match(/^(\d+\.)/)[1];
      result.push('<span class="md-number">' + num + '</span>' + escaped.slice(num.length));
    } else if (/^[-*]\s/.test(line) || /^\s+[-*]\s/.test(line)) {
      result.push('<span class="md-list">' + escaped + '</span>');
    } else {
      // Bold markers
      result.push(escaped.replace(/\*\*([^*]+)\*\*/g, '<span class="md-bold">**$1**</span>'));
    }
  }
  return result.join('\n');
}

export function highlightYamlLine(escaped) {
  var match = escaped.match(/^(\s*)([\w-]+)(:)(.*)/);
  if (match) {
    return match[1] +
      '<span class="yaml-key">' + match[2] + '</span>' +
      '<span class="yaml-delim">' + match[3] + '</span>' +
      '<span class="yaml-value">' + match[4] + '</span>';
  }
  // List items in frontmatter
  if (/^\s*-\s/.test(escaped)) {
    return '<span class="yaml-value">' + escaped + '</span>';
  }
  return escaped;
}

export function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
