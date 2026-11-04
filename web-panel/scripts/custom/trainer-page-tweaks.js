// Trainer page tweaks for the Wand renderer:
// - hides the Highlights card and stretches the neighbouring card (usually the map) over its slot;
// - adds a "Created by" card with the trainer author at the end of the page, like the old trainer page.
// Add this file in the patch dialog (Custom scripts > Add .js). Custom scripts need the remote access patch.
(() => {
    // The bootstrap also reaches overlay windows and about:blank; only the main window shows trainer pages.
    if (!/\/index\.html$/i.test(globalThis.location?.pathname ?? '')) {
        return;
    }

    if (globalThis.__wandTrainerPageTweaks) {
        return;
    }

    globalThis.__wandTrainerPageTweaks = true;

    const STYLE_ID = 'wand-trainer-page-tweaks';
    const AUTHOR_CARD_CLASS = 'wtp-author-card';
    const CDN_BASE_URL = 'https://api-cdn.wemod.com';
    const AVATAR_SIZE = 48;
    const APPLY_DELAY_MS = 200;
    const CATALOG_RESCAN_MS = 10000;
    const LABELS = {
        en: { title: 'Trainer', createdBy: 'Created by', unassigned: 'Unassigned' },
        ru: { title: 'Трейнер', createdBy: 'Автор', unassigned: 'Не указан' },
        uk: { title: 'Трейнер', createdBy: 'Автор', unassigned: 'Не вказано' },
    };
    const PERSON_ICON =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.3 0-8 1.7-8 5v1h16v-1c0-3.3-4.7-5-8-5Z"/></svg>';

    // Highlights is Wand's "clips" feature card. The other cards keep their grid slots (the hidden card still
    // counts for :nth-child), so each layout that holds clips stretches the card next to it over the gap.
    const STYLE = `
.bento__layout .bento__bento-card--clips { display: none !important; }
.bento__layout.bento--feature-count-3:has(.bento__bento-card--clips) .bento__bento-card--map { grid-column: 1 / -1 !important; }
.bento__layout.bento--feature-count-4:has(.bento__bento-card--clips) .bento__bento-card--map { grid-column: 1 / 4 !important; }
.bento__layout.bento--feature-count-2:has(.bento__bento-card--clips) .bento__bento-card--customize { grid-column: 1 / -1 !important; }
.bento__layout.bento--feature-count-3:not(.bento--has-ad):not(:has(.bento__bento-card--map)):has(.bento__bento-card--clips) .bento__bento-card--game-guide { grid-row: 1 / -1 !important; }
.bento__layout.bento--feature-count-3.bento--has-ad:not(:has(.bento__bento-card--map)):has(.bento__bento-card--clips) .bento__bento-card--customize { grid-row: 1 / -1 !important; }

.${AUTHOR_CARD_CLASS} { margin-top: 16px; border-radius: 20px; background: rgba(13, 15, 18, 0.4); color: var(--theme--text-primary, #fff); }
.${AUTHOR_CARD_CLASS}__header { display: flex; align-items: center; gap: 10px; padding: 14px 20px 6px; font-size: 14px; line-height: 20px; font-weight: 500; }
.${AUTHOR_CARD_CLASS}__header svg { width: 16px; height: 16px; flex: 0 0 auto; fill: currentColor; }
.${AUTHOR_CARD_CLASS}__body { display: flex; align-items: center; gap: 8px; padding: 0 20px 16px; font-size: 13px; line-height: 20px; }
.${AUTHOR_CARD_CLASS}__label { color: var(--theme--text-secondary, rgba(255, 255, 255, 0.6)); }
.${AUTHOR_CARD_CLASS}__avatar { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }
.${AUTHOR_CARD_CLASS}__name { font-weight: 600; }
`;

    const log = (...args) => globalThis.WandEnhancer?.log?.('[trainer-page-tweaks]', ...args);

    let catalogHost = null;
    let lastCatalogScan = 0;
    let applyTimer = 0;
    let reportedMissingCatalog = false;

    function installStyle() {
        if (document.getElementById(STYLE_ID) || !document.head) {
            return;
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = STYLE;
        document.head.appendChild(style);
    }

    function viewModelOf(element) {
        const viewModel = element?.au?.controller?.viewModel;
        return viewModel && typeof viewModel === 'object' ? viewModel : null;
    }

    function findViewModelUp(start, predicate) {
        for (let element = start; element; element = element.parentElement) {
            const viewModel = viewModelOf(element);
            if (viewModel && predicate(viewModel)) {
                return viewModel;
            }
        }

        return null;
    }

    function hasCreators(viewModel) {
        return Boolean(viewModel.catalog?.creators);
    }

    // The bento page itself does not select the catalog; a page component above it does.
    function findCatalog(layout) {
        const nearby = findViewModelUp(layout, hasCreators);
        if (nearby) {
            return nearby.catalog;
        }

        if (!catalogHost?.isConnected && Date.now() - lastCatalogScan > CATALOG_RESCAN_MS) {
            lastCatalogScan = Date.now();
            catalogHost =
                Array.from(document.querySelectorAll('*')).find((element) => {
                    const viewModel = viewModelOf(element);
                    return viewModel !== null && hasCreators(viewModel);
                }) ?? null;
        }

        return viewModelOf(catalogHost)?.catalog ?? null;
    }

    // Mirrors Wand's CdnValueConverter: absolute URLs pass through, "/path/{size}" gets the CDN base.
    function toCdnUrl(path) {
        if (typeof path !== 'string' || !path) {
            return '';
        }

        if (path.includes(':') || !path.startsWith('/')) {
            return path;
        }

        const resolved = path.replace('{size}', String(AVATAR_SIZE));
        return resolved.includes('{') ? '' : CDN_BASE_URL + resolved;
    }

    function textSpan(text, className) {
        const span = document.createElement('span');
        span.className = className;
        span.textContent = text;
        return span;
    }

    function buildAuthorCard(creator, key) {
        const language = (document.documentElement.lang || 'en').slice(0, 2).toLowerCase();
        const labels = LABELS[language] ?? LABELS.en;

        const card = document.createElement('div');
        card.className = AUTHOR_CARD_CLASS;
        card.dataset.key = key;

        const header = document.createElement('div');
        header.className = `${AUTHOR_CARD_CLASS}__header`;
        header.insertAdjacentHTML('beforeend', PERSON_ICON);
        header.append(labels.title);

        const body = document.createElement('div');
        body.className = `${AUTHOR_CARD_CLASS}__body`;
        body.append(textSpan(labels.createdBy, `${AUTHOR_CARD_CLASS}__label`));

        const avatarUrl = toCdnUrl(creator?.avatar);
        if (avatarUrl) {
            const avatar = document.createElement('img');
            avatar.className = `${AUTHOR_CARD_CLASS}__avatar`;
            avatar.alt = '';
            avatar.src = avatarUrl;
            avatar.addEventListener('error', () => avatar.remove(), { once: true });
            body.append(avatar);
        }

        body.append(textSpan(creator?.username || labels.unassigned, `${AUTHOR_CARD_CLASS}__name`));
        card.append(header, body);
        return card;
    }

    function apply() {
        installStyle();

        const layout = document.querySelector('.bento__layout');
        const customize = layout?.querySelector('.bento__bento-card--customize');
        if (!customize) {
            return;
        }

        const existing = Array.from(customize.children).find((child) =>
            child.classList.contains(AUTHOR_CARD_CLASS),
        );
        const page = findViewModelUp(layout, (viewModel) => 'selectedGame' in viewModel);
        const game = page?.selectedGame;
        const catalog = game ? findCatalog(layout) : null;
        if (!game || !catalog) {
            existing?.remove();
            if (game && !reportedMissingCatalog) {
                reportedMissingCatalog = true;
                log('Trainer catalog not found; the author card is skipped.');
            }

            return;
        }

        // selectedGame is the title's version entry; only the catalog game carries creatorId, as on the old page.
        const catalogGame = page.game ?? catalog.games?.[game.id];
        const creatorId = catalogGame?.creatorId ?? game.creatorId;
        const creator = creatorId ? catalog.creators[creatorId] : undefined;
        const key = `${game.id}|${creatorId ?? ''}|${creator?.username ?? ''}`;
        if (existing?.dataset.key === key && customize.lastElementChild === existing) {
            return;
        }

        existing?.remove();
        customize.appendChild(buildAuthorCard(creator, key));
    }

    function scheduleApply() {
        if (applyTimer) {
            return;
        }

        applyTimer = setTimeout(() => {
            applyTimer = 0;
            try {
                apply();
            } catch (error) {
                log('Update failed.', error);
            }
        }, APPLY_DELAY_MS);
    }

    function start() {
        const observer = new MutationObserver(scheduleApply);
        observer.observe(document.body, { childList: true, subtree: true });
        scheduleApply();
        log('Installed.');
    }

    if (document.body) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    }
})();
