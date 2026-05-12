/* eslint-disable no-underscore-dangle */
/* eslint-disable import/no-unresolved */
import { html, LitElement } from 'da-lit';
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import getStyle from 'https://da.live/nx/public/utils/styles.js';
import {
  setContext,
  getLangsAndLocales,
  populatePageData,
  copyPage,
  publishPages,
} from './index.js';

// Styles
const sl = await getStyle('https://da.live/nx/public/sl/styles.css');
const styles = await getStyle(import.meta.url);

class NxLocales extends LitElement {
  static properties = {
    _langs: { state: true },
    _locales: { state: true },
    _message: { state: true },
    _loading: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    this.shadowRoot.adoptedStyleSheets = [sl, styles];
    this.setup();
  }

  async setup() {
    const { message, langs, locales } = await getLangsAndLocales(this.path);
    if (message) {
      this._message = message;
      return;
    }
    this._langs = langs;
    this._locales = locales;

    // Load page data asynchronously after initial render
    this._loading = true;
    const { langs: updatedLangs, locales: updatedLocales } = await populatePageData(langs, locales);
    this._langs = updatedLangs;
    this._locales = updatedLocales;
    this._loading = false;
  }

  findInLang(langs) {
    return langs.find((item) => this.path.startsWith(`${item.location}/`));
  }

  flattenLocaleLangs() {
    return this._locales.reduce((acc, locale) => {
      acc.push(...locale.langs);
      return acc;
    }, []);
  }

  findCurrentLang() {
    let found = this.findInLang(this._langs);
    if (!found) {
      const flatLocaleLangs = this.flattenLocaleLangs();
      found = this.findInLang(flatLocaleLangs);
    }
    return found;
  }

  async handleCreate(page) {
    await copyPage(
      `/${this.org}/${this.site}${page.currentPath}`,
      page.newFullPath,
    );
    this.actions.setHref(`https://da.live/edit#${page.newFullPath}`);
  }

  async handleOpen(page) {
    this.actions.setHref(`https://da.live/edit#${page.newFullPath}`);
  }

  getPage(lang) {
    const found = this.findCurrentLang();
    if (!found) return;

    const copyFromLocation = found.globalLocation || found.location;
    const copyFromPath = this.path.replace(found.location, copyFromLocation);
    const newPath = this.path.replace(found.location, lang.location);
    const newFullPath = `/${this.org}/${lang.site}${newPath}`;
    const newAEMFullPath = `/${this.org}/${lang.site}/main${newPath}`;

    // eslint-disable-next-line consistent-return
    return {
      ...lang,
      currentPath: copyFromPath,
      newFullPath,
      newPath,
      newAEMFullPath,
    };
  }

  _liveUrlsJoinFromLangs(langs) {
    const urls = langs.map((lang) => lang.aemStatus?.live?.url).filter(Boolean);
    return urls.length ? urls.join('\n') : '';
  }

  /**
   * Clipboard API only. Call from a user gesture (e.g. publish click) before long awaits.
   */
  async _copyPlainTextToClipboard(text) {
    try {
      const type = 'text/plain';
      const clipboardItem = new ClipboardItem({ [type]: [text] });
      await navigator.clipboard.write([clipboardItem]);
      return true;
    } catch (err) {
      console.error('Clipboard copy failed:', err);
      return false;
    }
  }

  _afterPublishComplete(published, didPreCopy) {
    if (!published?.length) {
      setTimeout(() => { this._message = undefined; }, 2500);
      return;
    }
    const respUrls = published.map((p) => p.resp?.live?.url).filter(Boolean);
    if (!respUrls.length) {
      this._message = { text: 'No pages published' };
      setTimeout(() => { this._message = undefined; }, 2500);
      return;
    }
    const respJoined = respUrls.join('\n');
    const n = respUrls.length;
    if (didPreCopy) {
      this._message = {
        text: `${n} page(s) published — URLs copied to clipboard.`,
        publishedUrlsText: respJoined,
      };
      setTimeout(() => { this._message = undefined; }, 2500);
      return;
    }
    this._message = {
      text: 'Publishing finished. Click Copy URLs to copy live links.',
      publishCopyText: respJoined,
    };
  }

  /**
   * Second-chance copy when pre-publish copy failed (new user gesture).
   */
  async _handlePublishCopyClick(joined) {
    const urlCount = joined.split('\n').length;
    const ok = await this._copyPlainTextToClipboard(joined);
    if (!ok) {
      this._message = {
        text: 'Could not copy automatically. Select the URLs below and copy (Ctrl/Cmd+C).',
        manualCopyText: joined,
      };
      return;
    }
    this._message = {
      text: `${urlCount} page(s) published — URLs copied to clipboard.`,
      publishedUrlsText: joined,
    };
    setTimeout(() => { this._message = undefined; }, 2500);
  }

  async handlePublishAll(items) {
    const publishLangs = items[0].langs
      ? this.flattenLocaleLangs(items)
      : items;
    const langsToPublish = publishLangs.filter((lang) => lang.aemStatus);
    const pageList = langsToPublish.map((lang) => ({ path: this.getPage(lang).newAEMFullPath }));
    const preJoined = this._liveUrlsJoinFromLangs(langsToPublish);
    let didPreCopy = false;
    if (preJoined) {
      didPreCopy = await this._copyPlainTextToClipboard(preJoined);
    }
    this._message = { text: 'Publishing ...' };
    const published = await publishPages(pageList);
    this._afterPublishComplete(published, didPreCopy);
  }

  async handlePublish(item) {
    const preJoined = item.aemStatus?.live?.url || '';
    let didPreCopy = false;
    if (preJoined) {
      didPreCopy = await this._copyPlainTextToClipboard(preJoined);
    }
    this._message = { text: 'Publishing ...' };
    const published = await publishPages([{ path: item.newAEMFullPath }]);
    this._afterPublishComplete(published, didPreCopy);
  }

  renderActionButtons(page) {
    if (!page.status) return '';

    const publishButton = page.exists ? html`<button class="publish-button" @click=${() => this.handlePublish(page)}>Publish</button>` : '';
    const editButton = page.exists ? html`<button class="edit-button" @click=${() => this.handleOpen(page)}>Edit</button>` : html`<button class="create-button" @click=${() => this.handleCreate(page)}>Create</button>`;

    return html`
      ${publishButton}
      ${editButton}
    `;
  }

  // eslint-disable-next-line class-methods-use-this
  renderAEMStatus(page) {
    if (!page.status || !page.exists || !page.aemStatus?.live) return '';
    const aemStatus = page.aemStatus.live;
    return html`
      <div
        title="${aemStatus.status === 200 ? aemStatus.lastModified : 'Not published'}"
        class="icon icon-aem ${aemStatus.status ? `status-${aemStatus.status}` : ''}"
      ></div>
    `;
  }

  renderLocaleLangs(name, langs) {
    return html` <p>${name}</p>
      <div class="locale-lang-list-container">
        <ul class="locale-lang-group-list">
          ${langs.map((lang) => {
    const page = this.getPage(lang);
    const isCurrent = page.newPath === this.path && this.site === lang.site;
    return html` <li>
            <p class="${isCurrent ? 'current' : ''}">${lang.name}</p>
            <div class="locale-lang-buttons">
              ${this.renderActionButtons(page)}
            </div>
            <div class="aem-status">
              ${this.renderAEMStatus(page)}
            </div>
          </li>`;
  })}
        </ul>
      </div>`;
  }

  renderGroupLang(name, lang) {
    const page = this.getPage(lang);
    const isCurrent = page.newPath === this.path && this.site === lang.site;
    return html` <p class="${isCurrent ? 'current' : ''}">${name}</p>
      <div class="lang-button">
        ${this.renderActionButtons(page)}
      </div>
      <div class="aem-status">
        ${this.renderAEMStatus(page)}
      </div>`;
  }

  renderGroup(title, items) {
    return html`
      <div class="lang-group">
        <div class="lang-group-header">
          <p>${title}</p>
          <button @click=${() => this.handlePublishAll(items)}>
            Publish all
          </button>
        </div>
        <ul class="lang-group-list">
  ${items.map(
    (item) => html` <li class="lang-top-list-item">
      ${item.langs
    ? this.renderLocaleLangs(item.name, item.langs)
    : this.renderGroupLang(item.name, item)}
    </li>`,
  )}
        </ul>
      </div>
    `;
  }

  updated(changed) {
    if (changed.has('_message') && (this._message?.manualCopyText || this._message?.publishedUrlsText)) {
      requestAnimationFrame(() => {
        const ta = this.shadowRoot?.querySelector('textarea.manual-copy');
        if (ta) {
          ta.focus();
          ta.select();
        }
      });
    }
    super.updated(changed);
  }

  renderMessage() {
    const {
      text, manualCopyText, publishCopyText, publishedUrlsText,
    } = this._message;
    if (publishedUrlsText) {
      return html`
        <div class="message">
          <div class="message-panel message-panel--published-urls">
            <p>${text}</p>
            <textarea class="manual-copy" readonly rows="3" .value=${publishedUrlsText}></textarea>
            <div class="message-publish-copy-actions">
              <button type="button" class="manual-copy-close" @click=${() => { this._message = undefined; }}>
                Close
              </button>
            </div>
          </div>
        </div>
      `;
    }
    if (publishCopyText) {
      return html`
        <div class="message">
          <div class="message-panel message-panel--publish-copy">
            <p>${text}</p>
            <textarea class="manual-copy" readonly rows="3" .value=${publishCopyText}></textarea>
            <div class="message-publish-copy-actions">
              <button type="button" class="publish-copy-urls" @click=${() => this._handlePublishCopyClick(publishCopyText)}>
                Copy URLs
              </button>
              <button type="button" class="manual-copy-close" @click=${() => { this._message = undefined; }}>
                Close
              </button>
            </div>
          </div>
        </div>
      `;
    }
    if (manualCopyText) {
      return html`
        <div class="message message--manual">
          <div class="message-panel message-panel--manual">
            <div class="message-manual-top">
              <span class="message-manual-hint">${text}</span>
              <button type="button" class="manual-copy-close" @click=${() => { this._message = undefined; }}>
                Close
              </button>
            </div>
            <textarea class="manual-copy" readonly rows="3" .value=${manualCopyText}></textarea>
          </div>
        </div>
      `;
    }
    return html`
      <div class="message">
        <div class="message-panel">
          <p>${text}</p>
        </div>
      </div>
    `;
  }

  renderAll() {
    return html`
      ${this.renderGroup('Global languages', this._langs)}
      ${this.renderGroup('Locales', this._locales)}
      ${this._message && this.renderMessage()}
    `;
  }

  render() {
    return html`${this._langs && this.renderAll()}`;
  }
}

customElements.define('nx-locales', NxLocales);

(async function init() {
  const { context, token, actions } = await DA_SDK;
  setContext({ ...context, token });

  const nxLocales = document.createElement('nx-locales');
  nxLocales.org = context.org;
  nxLocales.site = context.repo;
  nxLocales.path = context.path;
  nxLocales.actions = actions;

  document.body.append(nxLocales);
}());
