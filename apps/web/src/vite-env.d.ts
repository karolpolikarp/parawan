/// <reference types="vite/client" />

// TS 6.0 (TS2882) wymaga deklaracji dla side-effect importów zasobów;
// vite/client pokrywa *.css, deklaracja niżej jest jawnym fallbackiem.
declare module '*.css';

// Moduł workera pdf.js nie ma typów — importujemy go tylko po to,
// żeby podstawić globalThis.pdfjsWorker (fake worker w buildzie single-file).
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs';
