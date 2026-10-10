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
      <p class="text-muted-foreground">Last updated: 8 October 2026</p>
      <p>This page explains what data we use and how to contact us about it.</p>
    </header>

    <h2>Cookies and analytics</h2>
    <p>
      We don't use analytics or advertising trackers. You don't need an account to use the site. The public site doesn't
      require sign-in cookies.
    </p>

    <h2>Hosting and logs</h2>
    <p>
      We use Cloudflare to host the site. Cloudflare processes your IP address to serve requests and protect its
      network. Default request logs are disabled. We use application logs to diagnose errors. Diagnostic logs and, when
      enabled, traces include the public npm package name and requested or resolved versions being compared, along with
      operation timing and correlation IDs. We exclude credentials, AI prompts, evidence packets and raw provider error
      text from these diagnostic records.
    </p>
    <p>
      When you enable diagnostics in your browser session, failures are reported automatically: rendering errors, page
      load failures and promise rejections are recorded with a scrubbed message and, where available, a code filename
      and location. Reported messages are filtered for email addresses, authorization headers, tokens and other
      credential-shaped values; URLs, query strings, function names and machine-local paths are not recorded. Server
      render and handler failures are reported the same way. These records never include package file contents, provider
      responses, or your IP address.
    </p>

    <h2>Package data and AI</h2>
    <p>
      We fetch public package data from npm, GitHub, OSV and Bundlephobia. We cache this data and save AI notes for
      reuse. Saved archive inspections and AI notes have no automatic expiry. When we detect changes to the source data
      used for a result, we generate a new result when it's next requested.
    </p>
    <p>
      To generate AI notes, we send comparison data and public release notes to an AI provider. This may include
      contributor names or handles from those sources.
    </p>

    <h2>Your rights</h2>
    <p>You can:</p>
    <ul>
      <li>Ask what data we use and how we use it.</li>
      <li>Clear cookies and site data in your browser.</li>
      <li>Request information about our privacy practices.</li>
    </ul>
    <p>We don't require an account or track visitors, so there is typically no visitor profile to delete or export.</p>

    <h2>Contact us</h2>
    <p>
      For questions about privacy, open an issue on our
      <a href="https://gitlab.com/uxpedition/can-i-npm-update/-/issues">GitLab repository</a>.
    </p>

    <h2>Changes</h2>
    <p>We'll publish changes here with an updated revision date.</p>
  </article>
</template>
