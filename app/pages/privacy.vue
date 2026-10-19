<script setup lang="ts">
import { definePageMeta, useSeoMeta } from '#imports';

definePageMeta({ layout: 'site' });

useSeoMeta({ title: 'Privacy · Can I Update?' });
</script>

<template>
  <article
    class="mx-auto max-w-[760px] px-10 py-12 text-sm leading-6 max-[700px]:px-5 max-[700px]:py-8 [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-mono [&_h2]:font-semibold [&_h2]:uppercase [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_a]:underline [&_a]:underline-offset-4 [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-4 [&_a:focus-visible]:outline-ring"
  >
    <header>
      <h1 class="font-mono text-3xl font-semibold uppercase tracking-tight">Privacy</h1>
      <p class="text-muted-foreground">Last updated: 17 October 2026</p>
      <p>Here's what data we use and why.</p>
    </header>

    <h2>Cookies and analytics</h2>
    <p>We don't use analytics or advertising trackers. No account or sign-in cookies are needed.</p>

    <h2>Hosting and logs</h2>
    <p>
      Cloudflare hosts the site and processes your IP address to serve requests and protect its network. Default request
      logs are disabled.
    </p>
    <p>
      We use diagnostic logs and traces to investigate errors. These can include public package names, compared
      versions, timings and IDs that link related operations.
    </p>
    <p>
      Browser diagnostics report errors automatically. Browser and server error records include the error type, source
      and code location, but not error messages, URLs, function names or local file paths.
    </p>
    <p>
      Diagnostics exclude your IP address, credentials, AI prompts, package file contents, evidence packets and provider
      responses.
    </p>

    <h2>Abuse prevention</h2>
    <p>
      We use a temporary hash of your IP address for Cloudflare rate limits, including limits on new AI notes. Hashing
      does not make it anonymous. People on the same network share these limits.
    </p>
    <p>
      This key stays out of saved jobs, package evidence, AI requests and diagnostic logs. We don't create visitor
      accounts or profiles for rate limiting.
    </p>

    <h2>Package data and AI</h2>
    <p>
      We fetch public package data from npm, GitHub, OSV and Bundlephobia, and save data and AI notes for reuse. Saved
      archive inspections and AI notes don't expire automatically.
    </p>
    <p>When we detect source data changes, we refresh the result the next time it's requested.</p>
    <p>
      AI providers receive comparison data and public release notes to generate AI notes. These may include contributor
      names or handles.
    </p>

    <h2>Your rights</h2>
    <p>You can ask what data we use or clear cookies and site data in your browser.</p>
    <p>We don't require accounts or track visitors, so there's usually no visitor profile to delete or export.</p>

    <h2>Contact us</h2>
    <p>
      For questions about privacy, open an issue on our
      <a href="https://gitlab.com/uxpedition/caniupdate.dev/-/work_items">GitLab repository</a>.
    </p>

    <h2>Changes</h2>
    <p>We'll publish changes here with an updated revision date.</p>
  </article>
</template>
