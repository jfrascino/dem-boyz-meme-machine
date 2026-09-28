/* Vendored: js-binary-schema-parser 2.0.3; MIT, Copyright (c) 2015 Matt Way. See accompanying LICENSE files and provenance.json. */
/**
 * Bundled by jsDelivr using Rollup v4.62.2 and esbuild v0.28.1.
 * Original file: /npm/js-binary-schema-parser@2.0.3/lib/index.js
 *
 * Do NOT use SRI with dynamically generated files! More information: https://www.jsdelivr.com/using-sri-with-dynamic-files
 */
var e={},d;function b(){if(d)return e;d=1,Object.defineProperty(e,"__esModule",{value:!0}),e.loop=e.conditional=e.parse=void 0;var s=function u(a,n){var r=arguments.length>2&&arguments[2]!==void 0?arguments[2]:{},o=arguments.length>3&&arguments[3]!==void 0?arguments[3]:r;if(Array.isArray(n))n.forEach(function(t){return u(a,t,r,o)});else if(typeof n=="function")n(a,r,o,u);else{var i=Object.keys(n)[0];Array.isArray(n[i])?(o[i]={},u(a,n[i],r,o[i])):o[i]=n[i](a,r,o,u)}return r};e.parse=s;var c=function(a,n){return function(r,o,i,t){n(r,o,i)&&t(r,a,o,i)}};e.conditional=c;var g=function(a,n){return function(r,o,i,t){for(var f=[],p=r.pos;n(r,o,i);){var v={};if(t(r,a,o,v),r.pos===p)break;p=r.pos,f.push(v)}return f}};return e.loop=g,e}var l=b(),_=l.__esModule,A=l.conditional,M=l.loop,j=l.parse;export{_ as __esModule,A as conditional,l as default,M as loop,j as parse};
