<template>
  <footer class="border-t border-border/55 font-body text-xs leading-relaxed text-muted-foreground">
    <div
      class="mx-auto flex max-w-[1040px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-10 py-6 max-[700px]:px-5"
    >
      <a
        href="/"
        class="font-mono text-[10px] font-semibold tracking-[-0.04em] text-foreground hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-ring"
        >can i update<span class="text-change" aria-hidden="true">?</span></a
      >
      <nav
        aria-label="Legal and contact"
        class="flex flex-wrap gap-x-6 gap-y-2 [&_a]:underline-offset-4 [&_a:hover]:underline [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-4 [&_a:focus-visible]:outline-ring"
      >
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="mailto:hello@adrianani.com">Contact</a>
      </nav>
    </div>
  </footer>
</template>
