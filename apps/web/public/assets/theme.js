/*
 * theme.js — shared light/dark toggle for HQ dashboard pages.
 * ライト/ダークモード導入ラン(2026-07-18・共通ルール)の基盤スクリプト。
 *
 * Contract (do not change per-page, only extend usage):
 *   1. localStorage['hqTheme'] wins; if unset, follow prefers-color-scheme.
 *   2. Resulting theme ('light'|'dark') is written as <html data-theme="...">.
 *   3. A slim toggle button (id="hqThemeToggle") is appended to the end of
 *      the page's header slim bar (first ".headbar" found) once the DOM is
 *      ready. Pages must style ".hdtoggle" already (review/index.html and
 *      mockups/判定シート.html both do) — this script reuses that class so
 *      no CSS needs to ship with theme.js itself.
 *   4. A 'storage' listener re-applies the theme when another tab changes it,
 *      so all open HQ tabs stay in sync.
 *
 * Load this with a plain synchronous <script src> in <head>, BEFORE any
 * visible content — step 1/2 run immediately (top-level, not inside
 * DOMContentLoaded) so data-theme is set before first paint (no FOUC). Each
 * page's own <style> must define :root{...} (dark defaults, unchanged) and
 * [data-theme="light"]{...} (overrides) using the same --var names; this
 * script only flips the attribute, it carries no styling itself.
 */
(function () {
  'use strict';
  var STORAGE_KEY = 'hqTheme';
  var root = document.documentElement;

  function systemTheme() {
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches)
      ? 'light' : 'dark';
  }

  function currentTheme() {
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* file:// or blocked storage */ }
    return (saved === 'light' || saved === 'dark') ? saved : systemTheme();
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    var btn = document.getElementById('hqThemeToggle');
    if (btn) btn.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
  }

  // 1 + 2: run synchronously now, before body paints.
  applyTheme(currentTheme());

  function toggleTheme() {
    var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* file:// or blocked storage */ }
    applyTheme(next);
  }

  function injectToggleButton() {
    if (document.getElementById('hqThemeToggle')) return;
    var bar = document.querySelector('.headbar');
    if (!bar) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'hqThemeToggle';
    btn.className = 'hdtoggle';
    btn.title = 'ライト/ダーク切替';
    btn.setAttribute('aria-label', 'ライト/ダーク切替');
    btn.textContent = '🌓'; // 🌓
    btn.addEventListener('click', toggleTheme);
    bar.appendChild(btn);
    applyTheme(root.getAttribute('data-theme') || currentTheme());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectToggleButton);
  } else {
    injectToggleButton();
  }

  // 4: other tabs
  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) applyTheme(currentTheme());
  });
})();
