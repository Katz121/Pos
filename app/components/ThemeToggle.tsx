'use client';

export default function ThemeToggle() {
  return (
    <button
      onClick={() => {
        const html = document.documentElement;
        const isDark = html.classList.toggle('dark');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
      }}
      className="ml-2 px-3 py-1 rounded border border-neutral-300 dark:border-neutral-700 hover:bg-gray-100 dark:hover:bg-neutral-800 text-xs"
      title="สลับ Light/Dark"
    >
      <span className="hidden dark:inline">🌙 Dark</span>
      <span className="dark:hidden">☀️ Light</span>
    </button>
  );
}
