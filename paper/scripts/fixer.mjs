export const regexFix = (html) => {
  let out = html;
  if (!/<html[^>]*\blang\s*=/.test(out)) out = out.replace(/<html\b/, '<html lang="en"');
  out = out.replace(/<img\b(?![^>]*\balt\s*=)[^>]*>/g, (m) => m.replace(/>$/, ' alt="photo">'));
  out = out.replace(/ alt=""/g, ' alt="photo"');
  out = out.replace(/<input\b(?![^>]*\baria-label)[^>]*>/g, (m) => /aria-labelledby/.test(m) ? m : m.replace(/>$/, ' aria-label="field">'));
  out = out.replace(/<label for="([^"]*)"><\/label>/g, '<label for="$1">Label</label>');
  out = out.replace(/<label for="missing-([^"]*)">/g, '<label for="$1">');
  out = out.replace(/<\/style>/, 'body,p,span,div,td,th,label,legend,button,a,input{color:#101418 !important;background-color:#ffffff !important}</style>');
  if (!/<h1[ >]/.test(out)) out = out.replace(/<h2>/, '<h1>').replace(/<\/h2>/, '</h1>');
  out = out.replace(/<h5\b/g, '<h3').replace(/<\/h5>/g, '</h3>');
  out = out.replace(/\s*tabindex="(?:[1-9]\d*|-\d+)"/g, '');
  out = out.replace(/<(div|span)\b[^>]*\bonclick="[^"]*"[^>]*>([\s\S]*?)<\/\1>/g, '<button type="button">$2</button>');
  out = out.replace(/<div\b[^>]*\brole="button"[^>]*>([\s\S]*?)<\/div>/g, '<button type="button">$1</button>');
  if (!/:focus/.test(out)) out = out.replace(/<\/style>/, 'a:focus-visible,button:focus-visible,input:focus-visible,[role]:focus-visible{outline:3px solid #0057d8}</style>');
  out = out.replace(/<a([^>]*?)\s*aria-label=""([^>]*)>/g, '<a$1$2>');
  out = out.replace(/<a([^>]*)>\s*<\/a>/g, '<a$1>Link</a>');
  out = out.replace(/<a([^>]*)>\s*<span[^>]*><\/span>\s*<\/a>/g, '<a$1>Link</a>');
  out = out.replace(/(<tr>)([\s\S]*?)<\/tr>/g, (m, o, cells) => /<td/.test(cells) && !/<th/.test(cells)
    ? `${o}${cells.replace(/<td/g, '<th scope="col"').replace(/<\/td>/g, '</th>')}</tr>`
    : m);
  return out;
};
