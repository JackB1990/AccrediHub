// Minimal multipart/form-data parser (enough for image uploads).
export function parseMultipart(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return { fields: {}, files: [] };
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  const fields = {};
  const files = [];

  let pos = buffer.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (buffer.slice(start, start + 2).toString() === '--') break; // closing boundary
    const next = buffer.indexOf(boundary, start);
    if (next === -1) break;
    // part = CRLF headers CRLFCRLF body CRLF
    let part = buffer.slice(start + 2, next - 2);
    const headEnd = part.indexOf('\r\n\r\n');
    if (headEnd !== -1) {
      const head = part.slice(0, headEnd).toString('utf8');
      const body = part.slice(headEnd + 4);
      const disp = /content-disposition:[^\r\n]*/i.exec(head)?.[0] || '';
      const name = /name="([^"]*)"/i.exec(disp)?.[1];
      const filename = /filename="([^"]*)"/i.exec(disp)?.[1];
      const ctype = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim();
      if (name !== undefined) {
        if (filename !== undefined) files.push({ field: name, filename, contentType: ctype || 'application/octet-stream', buffer: body });
        else fields[name] = body.toString('utf8');
      }
    }
    pos = next;
  }
  return { fields, files };
}
