import type { FC } from 'hono/jsx'
import type { Release, ReleaseType } from '../content/parse.js'
import { TYPES } from '../content/parse.js'
import { heading } from '../theme.js'
import { EMBED_SCRIPT_URL } from '../assets.js'
import { fmt, groupByMonth, Layout, SiteHeader, TypeLabel, type PageContext } from './layout.js'
import { entryJsonLd, listJsonLd } from '../seo.js'

const FILTER_LABEL: Record<ReleaseType, string> = { new: 'New features', improved: 'Improvements', fixed: 'Fixes' }

const Entry: FC<{ ctx: PageContext; entry: Release; single?: boolean; sameDay?: boolean; eager?: boolean }> = ({ ctx, entry: e, single = false, sameDay = false, eager = false }) => (
  <article class={sameDay ? 'entry same-day' : 'entry'} id={e.slug} data-type={e.type}>
    <div class='entry-date'>
      <time datetime={e.date}><span class='d'>{fmt.day(e.date)}</span> {fmt.monShort(e.date)}</time>
    </div>
    <div class='entry-node' aria-hidden='true' />
    <div class='entry-body'>
      <TypeLabel type={e.type} cfg={ctx.cfg} />
      {e.draft && <span class='draft'>Draft</span>}
      {e.internal && <span class='draft internal'>Internal</span>}
      {!e.draft && !e.internal && e.date > new Date().toISOString().slice(0, 10) && <span class='draft'>Scheduled</span>}
      {single
        ? <h1 class='entry-title'>{e.title}</h1>
        : <h3 class='entry-title'><a href={`/${e.slug}`}>{e.title}</a></h3>}
      {e.image && (
        <img
          class='entry-image'
          src={e.image}
          alt={e.title}
          width={e.imageSize?.width}
          height={e.imageSize?.height}
          loading={eager ? 'eager' : 'lazy'}
          fetchpriority={eager ? 'high' : undefined}
          decoding='async'
        />
      )}
      <div class='prose' dangerouslySetInnerHTML={{ __html: e.html }} />
      {e.tags.length > 0 && <ul class='tags'>{e.tags.map(t => <li>{t}</li>)}</ul>}
    </div>
  </article>
)

/** Link to page `n` of the list, keeping the type filter. Page 1 of the unfiltered list is `/`. */
export const pageHref = (n: number, type: ReleaseType | null) =>
  type ? `/?type=${type}${n > 1 ? `&page=${n}` : ''}` : n > 1 ? `/page/${n}` : '/'

export const ListPage: FC<{ ctx: PageContext; entries: Release[]; type: ReleaseType | null; page: number }> = ({ ctx, entries, type, page }) => {
  const { cfg } = ctx
  const all = type ? entries.filter(e => e.type === type) : entries
  const pages = Math.max(1, Math.ceil(all.length / cfg.perPage))
  const shown = all.slice((page - 1) * cfg.perPage, page * cfg.perPage)
  const filters: [string, string][] = [['', 'Everything'], ...TYPES.map(t => [t, FILTER_LABEL[t]] as [string, string])]
  const path = pageHref(page, type)
  const title = page > 1 ? `${heading(cfg)}, page ${page}` : heading(cfg)
  return (
    <Layout
      ctx={ctx}
      title={title}
      description={cfg.description}
      path={path}
      noindex={type !== null}
      prev={page > 1 ? pageHref(page - 1, type) : undefined}
      next={page < pages ? pageHref(page + 1, type) : undefined}
      structuredData={listJsonLd(cfg, ctx.baseUrl, shown, path)}
      bodyClass='public'
    >
      <SiteHeader cfg={cfg} />
      <main class='wrap'>
        <section class='intro'>
          <h1>{heading(cfg)}</h1>
          {page === 1 && <p>{cfg.description}</p>}
          <nav class='filters' aria-label='Filter by type'>
            {filters.map(([value, label]) => (
              <a href={value ? `/?type=${value}` : '/'} aria-current={(type ?? '') === value ? 'page' : undefined}>{label}</a>
            ))}
            <a class='rss' href='/feed.xml'>RSS feed</a>
          </nav>
        </section>
        {shown.length === 0 && (
          <p class='empty'>
            {type
              ? <>Nothing of this type yet. <a href='/'>Show everything</a></>
              : 'No releases published yet. Add a Markdown file to the releases folder to publish the first one.'}
          </p>
        )}
        {groupByMonth(shown).map(g => (
          <section class='month' aria-labelledby={`m-${g.key}`}>
            <h2 class='month-label' id={`m-${g.key}`}>{g.label}</h2>
            <div class='timeline'>
              {g.entries.map((e, i) => <Entry ctx={ctx} entry={e} eager={e === shown[0]} sameDay={i > 0 && g.entries[i - 1]!.date === e.date} />)}
            </div>
          </section>
        ))}
        {pages > 1 && (
          <nav class='list-pager' aria-label='Pages'>
            {page > 1 ? <a href={pageHref(page - 1, type)} rel='prev'>Newer releases</a> : <span />}
            <span class='list-pager-count'>Page {page} of {pages}</span>
            {page < pages ? <a href={pageHref(page + 1, type)} rel='next'>Older releases</a> : <span />}
          </nav>
        )}
      </main>
    </Layout>
  )
}

export const EntryPage: FC<{ ctx: PageContext; entry: Release; newer?: Release; older?: Release }> = ({ ctx, entry, newer, older }) => (
  <Layout
    ctx={ctx}
    title={`${entry.title} | ${heading(ctx.cfg)}`}
    description={entry.summary || ctx.cfg.description}
    path={`/${entry.slug}`}
    image={entry.image}
    ogType='article'
    publishedTime={entry.date}
    noindex={entry.draft || entry.internal}
    structuredData={entryJsonLd(ctx.cfg, ctx.baseUrl, entry)}
    bodyClass='public single'
  >
    <SiteHeader cfg={ctx.cfg} />
    <main class='wrap'>
      <p class='back'><a href='/'>All releases</a></p>
      <p class='single-date'><time datetime={entry.date}>{fmt.long(entry.date)}</time></p>
      <div class='timeline'><Entry ctx={ctx} entry={entry} single eager /></div>
      <nav class='pager' aria-label='More releases'>
        {newer ? <a class='newer' href={`/${newer.slug}`}><span>Newer</span>{newer.title}</a> : <span />}
        {older && <a class='older' href={`/${older.slug}`}><span>Older</span>{older.title}</a>}
      </nav>
    </main>
  </Layout>
)

export const NotFoundPage: FC<{ ctx: PageContext }> = ({ ctx }) => (
  <Layout ctx={ctx} title={`Not found | ${heading(ctx.cfg)}`} description={ctx.cfg.description} noindex bodyClass='public'>
    <SiteHeader cfg={ctx.cfg} />
    <main class='wrap'>
      <section class='intro'>
        <h1>This release does not exist</h1>
        <p>It may have been renamed. <a href='/'>See all releases</a>.</p>
      </section>
    </main>
  </Layout>
)

/**
 * In-app view for the iframe. Entries render on the server; embed.js reads the
 * user token from the URL hash, marks unread entries and records them as seen.
 */
export const EmbedPage: FC<{ ctx: PageContext; entries: Release[]; theme: 'light' | 'dark' | 'auto' }> = ({ ctx, entries, theme }) => {
  const { cfg, baseUrl } = ctx
  const shown = entries.slice(0, cfg.embed.limit)
  return (
    <Layout ctx={ctx} title={cfg.embed.title} description={cfg.description} theme={theme} noindex bodyClass='embed'>
      <header class='embed-head'>
        <h1>{cfg.embed.title}</h1>
        <a href={baseUrl + '/'} target='_blank' rel='noopener'>Full changelog</a>
        <button type='button' class='embed-close' aria-label='Close' hidden>×</button>
      </header>
      <main>
        {shown.length === 0
          ? <p class='empty'>No releases yet. New features and fixes will show up here.</p>
          : (
            <ol class='embed-list'>
              {shown.map(e => (
                <li class='embed-item' data-slug={e.slug}>
                  <details>
                    <summary>
                      <span class='embed-meta'>
                        <TypeLabel type={e.type} cfg={cfg} />
                        <time datetime={e.date}>{fmt.day(e.date)} {fmt.monShort(e.date)}</time>
                        <span class='unread-dot' hidden><span class='sr'>Unread</span></span>
                      </span>
                      <span class='embed-title'>{e.title}</span>
                      {e.summary && <span class='embed-summary'>{e.summary}</span>}
                    </summary>
                    <div class='embed-full'>
                      {e.image && <img class='entry-image' src={e.image} alt='' loading='lazy' decoding='async' />}
                      <div class='prose' dangerouslySetInnerHTML={{ __html: e.html }} />
                      <a class='permalink' href={`${baseUrl}/${e.slug}`} target='_blank' rel='noopener'>Open in a new tab</a>
                    </div>
                  </details>
                </li>
              ))}
            </ol>
            )}
      </main>
      <script src={EMBED_SCRIPT_URL} defer />
    </Layout>
  )
}
