import { readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
const VERSION = '1.0.0';
const BASE = process.env.YAKUSU_BASE || 'https://gutsmcd-cmd.github.io/yakusu/';
const ESB = '/workspace/keshigomu/node_modules/.bin/esbuild';
const src = readFileSync('src/yakusu.js', 'utf8').replace('__RELAY_URL__', BASE + 'relay.html');
writeFileSync('/tmp/yakusu.src.js', src);
const min = execFileSync(ESB, ['/tmp/yakusu.src.js', '--minify', '--target=es2018', '--charset=utf8', '--legal-comments=none'], { encoding: 'utf8' }).trim();
writeFileSync('site/yakusu.js', '/* 訳す Yakusu v' + VERSION + ' */\n' + min + '\n');
const enc = (code) => 'javascript:' + encodeURIComponent(code).replace(/'/g, '%27');
const inline = enc(min.replace(/;$/, '') + ';void 0');
const loaderCode = `(function(d){if(window.__yakusu){window.__yakusu.toggle();return}var s=d.createElement('script');s.onerror=function(){alert('訳す: このページは外部スクリプトを禁止しています。おすすめ版（インライン版）のブックマークを使ってください。\\nThis page blocks outside scripts. Use the recommended (inline) bookmark.')};try{s.src='${BASE}yakusu.js?'+Math.floor(Date.now()/36e5);(d.body||d.documentElement).appendChild(s)}catch(e){s.onerror()}})(document)`;
const loader = enc(loaderCode);
writeFileSync('bookmarklet-inline.txt', inline + '\n');
writeFileSync('bookmarklet-loader.txt', loader + '\n');
const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const text = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
let html = readFileSync('src/index.template.html', 'utf8')
  .replace('__INLINE_ATTR__', () => attr(inline)).replace('__LOADER_ATTR__', () => attr(loader))
  .replace('__INLINE_TEXT__', () => text(inline)).replace('__VERSION__', VERSION);
writeFileSync('site/index.html', html);
console.log('min', min.length, 'inline', inline.length, 'loader', loader.length);
