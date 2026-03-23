const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Ensure directories exist
fs.mkdirSync(path.join(__dirname, '..', 'public', 'css'), { recursive: true });
fs.mkdirSync(path.join(__dirname, '..', 'public', 'js'), { recursive: true });

// Extract Style
const styleStart = html.indexOf('<style>');
const styleEnd = html.indexOf('</style>') + '</style>'.length;
if (styleStart !== -1 && styleEnd > styleStart) {
  const styleContent = html.substring(styleStart + '<style>'.length, styleEnd - '</style>'.length).trim();
  fs.writeFileSync(path.join(__dirname, '..', 'public', 'css', 'styles.css'), styleContent);
  html = html.substring(0, styleStart) + '<link rel="stylesheet" href="css/styles.css">' + html.substring(styleEnd);
}

// Extract Main Script
// We look for `<script>` directly without attributes
const scriptStartStr = '<script>';
const scriptEndStr = '</script>';

// Find the last `<script>` tag in the header or wherever it is
// Looking at the file, the main script seems to be the one without "src="
const parts = html.split('<script>');
let scriptStart = -1;
let scriptEnd = -1;
let mainScriptContent = '';

for (let i = 1; i < parts.length; i++) {
  const p = parts[i];
  if (!html.substring(html.indexOf(p) - 8, html.indexOf(p)).includes('src=')) {
     // This part actually begins with the content of the <script> 
     // We can just find the indexOf `<script>` and check if it's the right one.
     scriptStart = html.indexOf('<script>', html.indexOf(p) - 9);
     scriptEnd = html.indexOf('</script>', scriptStart);
     if (scriptStart !== -1 && scriptEnd !== -1) {
       mainScriptContent = html.substring(scriptStart + '<script>'.length, scriptEnd).trim();
       html = html.substring(0, scriptStart) + '<script src="js/app_temp.js"></script>' + html.substring(scriptEnd + '</script>'.length);
       fs.writeFileSync(path.join(__dirname, '..', 'public', 'js', 'app_temp.js'), mainScriptContent);
       break;
     }
  }
}

fs.writeFileSync(htmlPath, html);
console.log('Extraction complete!');
