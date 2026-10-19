<script setup lang="ts">
import { definePageMeta, useSeoMeta } from '#imports';

definePageMeta({ layout: 'site' });

useSeoMeta({
  title: 'About · Can I Update?',
  description:
    'Learn how Can I Update? compares public npm package versions, where its evidence comes from, and what partial coverage and AI notes cannot tell you.',
});
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
      Can I Update? is a free, open-source tool for comparing two versions of one public npm package. See changes to
      dependencies, Node requirements, exports, types, bundle estimates and known security advisories.
    </p>

    <h2>Where the evidence comes from</h2>
    <ul>
      <li>
        <strong>npm:</strong> Published package metadata supplies declared dependencies, Node requirements, exports and
        type mappings. Package archives supply file sizes and shipped changelogs. These do not prove how the package
        behaves in your application.
      </li>
      <li>
        <strong>GitHub:</strong> Release notes and changelogs provide maintainer descriptions of changes for AI notes,
        when a supported repository and matching versions can be identified. They may omit changes.
      </li>
      <li>
        <strong>OSV:</strong> This security advisory database supplies known issues matched to the selected versions. It
        is not a security audit or a scan of your project. No matches does not mean a package is safe.
      </li>
      <li>
        <strong>Bundlephobia:</strong> Bundle and gzip size estimates describe the package on its own, not its size
        inside your application. Incomplete builds cannot be compared reliably.
      </li>
    </ul>

    <h2>Coverage and freshness</h2>
    <p>
      Sources can fail, be incomplete or exceed collection limits. Other evidence can still be shown when one source is
      missing. Missing or partial evidence means uncertainty, not “nothing changed,” “fixed” or “safe.”
    </p>
    <p>
      A collection or retrieval date says when evidence was fetched, not when a package was released. Release dates
      describe publication; they do not show when we last checked a source.
    </p>
    <p>
      Some evidence is cached, and upstream sources can lag or change. Reopening a comparison does not guarantee every
      source is current. AI notes may also be reused when the collected evidence matches.
    </p>

    <h2>Facts, claims and AI notes</h2>
    <p>
      A measured size, a dependency declared by a package and a maintainer's release-note claim are different kinds of
      evidence. AI notes interpret the collected evidence and cite sources; they are not independent verification.
    </p>
    <p>
      AI notes can be wrong or miss important changes. The factual comparison remains usable without them. Check the
      sources and test your update.
    </p>

    <h2>What it doesn't do</h2>
    <ul>
      <li>It isn't a package manager. It doesn't install or update packages.</li>
      <li>It doesn't inspect your project.</li>
      <li>It doesn't guarantee an upgrade will work in your application.</li>
      <li>It doesn't approve updates, give a safety score or provide a complete API compatibility analysis.</li>
    </ul>

    <h2>Get in touch</h2>
    <p>
      For questions or feedback, open an issue on our
      <a href="https://gitlab.com/uxpedition/caniupdate.dev/-/work_items">GitLab repository</a>. You can also
      <a href="https://gitlab.com/uxpedition/caniupdate.dev">browse the source code</a>.
    </p>
  </article>
</template>
