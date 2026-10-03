<script setup lang="ts">
import { definePageMeta, useSeoMeta } from '#imports';

definePageMeta({ layout: 'site' });
useSeoMeta({ title: 'About · Can I Update?' });
</script>

<template>
  <article
    class="mx-auto max-w-[760px] px-10 py-12 text-sm leading-6 max-[700px]:px-5 max-[700px]:py-8 [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-mono [&_h2]:font-semibold [&_h2]:uppercase [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_a]:underline [&_a]:underline-offset-4 [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-4 [&_a:focus-visible]:outline-ring"
  >
    <header>
      <h1 class="font-mono text-3xl font-semibold uppercase tracking-tight">About</h1>
      <p class="text-muted-foreground">See what changed before updating an npm package.</p>
    </header>

    <h2>What it does</h2>
    <p>
      Can I Update? is a free, open-source tool for comparing two versions of an npm package. See changes to
      dependencies, Node requirements, exports, types, bundle estimates and known security advisories.
    </p>
    <p>
      Package data comes from npm, GitHub, OSV and Bundlephobia. AI notes explain changes and link to their sources.
    </p>

    <h2>What it doesn't do</h2>
    <ul>
      <li>It isn't a package manager. It doesn't install or update packages.</li>
      <li>It doesn't inspect your project.</li>
      <li>It doesn't guarantee an upgrade will work in your application.</li>
    </ul>
    <p>AI notes can be wrong. Check the sources and test your update.</p>

    <h2>Get in touch</h2>
    <p>
      For questions or feedback, open an issue on our
      <a href="https://gitlab.com/uxpedition/can-i-npm-update/-/issues">GitLab repository</a>.
    </p>
  </article>
</template>
