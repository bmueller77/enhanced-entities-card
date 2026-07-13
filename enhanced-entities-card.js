/**
 * Enhanced-Entities-Card  (v0.9.3.0)
 * ==================================
 * Author:  Bjoern Mueller
 * Contact: bjoern@mueller.family
 *
 * Like the stock Entities card, plus per entry:
 *   - icon_color: static icon color
 *   - icon / icon_color depending on state (true/false map OR numeric thresholds)
 *   - color_gradient: linear color interpolation between numeric thresholds
 *   - name omitted or blank: the value is shown right next to the icon
 *   - action: more-info (default) | toggle | none  (tap behavior per entry;
 *     "toggle" switches the entity, "none" makes the row read-only)
 *   - true/false maps also match on/off, 1/0 and yes/no states
 *   - hide_state: true            (per entry: hide the value text)
 *   - icon_position: right        (per entry: icon at the far right; default left)
 * Special rows (movable in the GUI editor just like entities):
 *   - type: divider   -> 1px line in the card border color, fixed 5px side gap
 *   - type: markdown  -> markdown text (content), optional align,
 *                        fixed 10px side gap (rendered via ha-markdown);
 *                        supports {iobroker.object.id} templates with live
 *                        updates, just like the stock markdown card
 * Global appearance options (number = px, or any CSS unit; empty = default):
 *   - font_size (inherit), row_gap (16px),
 *   - padding_top / padding_bottom (8px), padding_left / padding_right (16px),
 *   - icon_size (24px), icon_gap (8px, icon-to-text)
 * GUI editor with entity search (ha-entity-picker), icon search
 * (ha-icon-picker), color pickers and per-row move/delete controls.
 *
 * YAML example:
 *
 *  type: custom:enhanced-entities-card
 *  title: Example
 *  font_size: 14px
 *  row_gap: 8
 *  entities:
 *    - type: markdown
 *      content: "**Temperatures**"
 *      align: center            # left (default) / center / right
 *    - entity: switch.foo
 *      name: Static
 *      icon: mdi:lightbulb
 *      icon_color: "#ffa000"
 *    - type: divider
 *    - entity: binary_sensor.door
 *      name: By true/false
 *      icon:       { "true": mdi:door-open,  "false": mdi:door }
 *      icon_color: { "true": "#43a047",      "false": "#e53935" }
 *    - entity: sensor.temperature
 *      name: By numeric value   # highest threshold <= value wins
 *      icon:
 *        - { value: -50, icon: mdi:snowflake }
 *        - { value: 18,  icon: mdi:thermometer }
 *        - { value: 25,  icon: mdi:fire }
 *      icon_color:
 *        - { value: -50, color: "#1e88e5" }
 *        - { value: 18,  color: "#fb8c00" }
 *        - { value: 25,  color: "#e53935" }
 *      color_gradient: true     # interpolate color between thresholds
 */

/* lazy-load ha-markdown (the stock markdown card renderer) */
let _eecMdLoaded = null;
function eecLoadMarkdown() {
  if (_eecMdLoaded) return _eecMdLoaded;
  _eecMdLoaded = (async () => {
    if (customElements.get('ha-markdown')) return;
    try {
      const helpers = window.loadCardHelpers ? await window.loadCardHelpers() : null;
      if (helpers) await helpers.createCardElement({ type: 'markdown', content: ' ' });
      await Promise.race([
        customElements.whenDefined('ha-markdown'),
        new Promise(res => setTimeout(res, 3000))
      ]);
    } catch (e) { /* fallback applies */ }
  })();
  return _eecMdLoaded;
}

class EnhancedEntitiesCard extends HTMLElement {
  setConfig(config) {
    if (!config || !Array.isArray(config.entities)) {
      throw new Error('enhanced-entities-card: "entities" (list) is required');
    }
    this._config = config;
    this._root = null;
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return (this._config.entities.length || 1) + (this._config.title ? 1 : 0);
  }

  /**
   * Resolves icon/color from the spec depending on state.
   * spec may be: string (static), object (state map, e.g. {true:..,false:..})
   * or array (numeric thresholds [{value, <field>}]).
   */
  _resolve(spec, stateVal, field, fallback) {
    if (spec === undefined || spec === null) return fallback;
    if (typeof spec === 'string') return spec;

    if (Array.isArray(spec)) {                       // numeric thresholds
      const num = parseFloat(stateVal);
      if (isNaN(num)) return fallback;
      let best = fallback, bestT = -Infinity;
      for (const r of spec) {
        const t = Number(r.value);
        // skip entries without icon/color set
        if (!isNaN(t) && num >= t && t > bestT && r[field]) {
          bestT = t;
          best = r[field];
        }
      }
      return best;
    }

    if (typeof spec === 'object') {                  // state map (true/false, on/off, ...)
      const key = String(stateVal).toLowerCase();
      // normalize common synonyms so editor keys "true"/"false" match on/off states
      const SYN = { 'on': 'true', 'off': 'false', '1': 'true', '0': 'false', 'yes': 'true', 'no': 'false' };
      const keys = [key];
      if (SYN[key]) keys.push(SYN[key]);
      for (const want of keys) {
        for (const k of Object.keys(spec)) {
          const kk = String(k).toLowerCase();
          if (kk === want || SYN[kk] === want) return spec[k] || fallback;
        }
      }
      return fallback;
    }
    return fallback;
  }

  /** Linearly blend two hex colors (t: 0..1). Returns null if not parseable. */
  _lerpColor(c1, c2, t) {
    const p = h => {
      const m = String(h).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
      if (!m) return null;
      let x = m[1];
      if (x.length === 3) x = x[0] + x[0] + x[1] + x[1] + x[2] + x[2];
      return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
    };
    const a = p(c1), b = p(c2);
    if (!a || !b) return null;
    return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }

  /** Color gradient across numeric thresholds: interpolates between adjacent rules. */
  _gradientColor(spec, num) {
    const rules = (spec || [])
      .filter(r => r && r.color && !isNaN(Number(r.value)))
      .map(r => ({ v: Number(r.value), c: r.color }))
      .sort((a, b) => a.v - b.v);
    if (!rules.length) return null;
    if (num <= rules[0].v) return rules[0].c;
    if (num >= rules[rules.length - 1].v) return rules[rules.length - 1].c;
    for (let i = 0; i < rules.length - 1; i++) {
      if (num >= rules[i].v && num <= rules[i + 1].v) {
        const t = (num - rules[i].v) / (rules[i + 1].v - rules[i].v);
        // non-parseable colors (names, var()): fall back to stepped behavior
        return this._lerpColor(rules[i].c, rules[i + 1].c, t) || rules[i].c;
      }
    }
    return rules[rules.length - 1].c;
  }

  _fmtState(st) {
    if (!st) return 'unavailable';
    const unit = st.attributes && st.attributes.unit_of_measurement;
    return unit ? (st.state + ' ' + unit) : st.state;
  }

  _moreInfo(entityId) {
    const ev = new Event('hass-more-info', { bubbles: true, composed: true });
    ev.detail = { entityId: entityId };
    this.dispatchEvent(ev);
  }

  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /** Length option: number -> px, string with unit as-is, empty -> default */
  _cssLen(v, def) {
    if (v === undefined || v === null || v === '') return def;
    if (typeof v === 'number') return v + 'px';
    const s = String(v).trim();
    return /^[0-9.]+$/.test(s) ? (s + 'px') : s;
  }

  _render() {
    if (!this._hass || !this._config) return;

    if (!this._root) {
      this.innerHTML = '';
      const card = document.createElement('ha-card');
      const style = document.createElement('style');
      style.textContent =
        '.eec-row{display:flex;align-items:center;cursor:pointer;}' +
        '.eec-row:hover{background:var(--secondary-background-color);}' +
        /* icon size + gap are applied as inline styles (configurable) */
        '.eec-icon{display:inline-flex;align-items:center;justify-content:center;overflow:hidden;line-height:1;' +
          'color:var(--state-icon-color,#44739e);}' +
        '.eec-info{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--primary-text-color);}' +
        '.eec-state{flex:0 0 auto;margin-inline-start:8px;text-align:right;color:var(--secondary-text-color);' +
          'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
        /* no name: value sits next to the icon instead of right-aligned */
        '.eec-state--inline{flex:0 1 auto;text-align:left;}' +
        '.eec-spacer{flex:1 1 auto;}' +
        '.eec-unavail{color:var(--error-color,#db4437);}';
      const body = document.createElement('div');
      body.className = 'eec-body';
      card.appendChild(style);
      card.appendChild(body);
      this.appendChild(card);
      this._root = card;
      this._body = body;
      // render cache + one-time click delegation (body survives innerHTML updates)
      this._teardownMdSubs();
      this._lastHtml = null;
      this._mdCache = {};
      const selfClick = this;
      body.addEventListener('click', function (ev) {
        const rowEl = ev.target && ev.target.closest ? ev.target.closest('.eec-row') : null;
        if (!rowEl || !selfClick._rows) return;
        const row = selfClick._rows[Number(rowEl.dataset.i)];
        if (!row || row.action === 'none') return;                     // read-only
        if (row.action === 'toggle') {
          selfClick._hass.callService('homeassistant', 'toggle', { entity_id: row.entityId });
        } else {
          selfClick._moreInfo(row.entityId);
        }
      });
    }
    if (this._config.title && this._root.header !== this._config.title) {
      this._root.header = this._config.title;
    }

    // appearance options as INLINE styles (per instance!):
    // class CSS acts globally in the light DOM and multiple cards on one
    // page would overwrite each other.
    {
      const cfg = this._config;
      const fs = this._cssLen(cfg.font_size, '');
      this._body.style.cssText =
        'display:flex;flex-direction:column;' +
        'gap:' + this._cssLen(cfg.row_gap, '16px') + ';' +
        'padding:' + this._cssLen(cfg.padding_top, '8px') + ' ' +
                     this._cssLen(cfg.padding_right, '16px') + ' ' +
                     this._cssLen(cfg.padding_bottom, '8px') + ' ' +
                     this._cssLen(cfg.padding_left, '16px') + ';' +
        (fs ? ('font-size:' + fs + ';') : '');
    }

    const rows = this._config.entities.map((raw) => {
      const cfg = (typeof raw === 'string') ? { entity: raw } : raw;
      if (cfg && cfg.type === 'divider') return { divider: true };
      if (cfg && cfg.type === 'markdown') return { markdown: String(cfg.content || ''), mdAlign: cfg.align || '' };
      const st = this._hass.states[cfg.entity];
      const stateVal = st ? st.state : '';
      // explicitly set name (even blank " ") wins; empty = show no name
      const name = (cfg.name !== undefined) ? cfg.name
        : ((st && st.attributes && st.attributes.friendly_name) || cfg.entity);
      const defIcon = (st && st.attributes && st.attributes.icon) || 'mdi:help-circle-outline';
      const icon = this._resolve(cfg.icon, stateVal, 'icon', defIcon);
      let color;
      if (cfg.color_gradient && Array.isArray(cfg.icon_color)) {
        const num = parseFloat(stateVal);
        color = isNaN(num) ? null : this._gradientColor(cfg.icon_color, num);
      } else {
        color = this._resolve(cfg.icon_color, stateVal, 'color', null);
      }
      return {
        entityId: cfg.entity,
        name: name,
        icon: icon,
        color: color,
        stateStr: this._fmtState(st),
        avail: !!st,
        action: cfg.action || 'more-info',  // 'more-info' | 'toggle' | 'none'
        hideState: !!cfg.hide_state,
        iconRight: cfg.icon_position === 'right'
      };
    });

    // dividers/markdown: fixed gap to the CARD EDGE, independent of the
    // configured card padding -> negative margin neutralizes the padding
    const eplv = this._cssLen(this._config.padding_left, '16px');
    const eprv = this._cssLen(this._config.padding_right, '16px');
    const edge = px => 'margin-left:calc(' + px + 'px - ' + eplv + ');margin-right:calc(' + px + 'px - ' + eprv + ');';
    const edgeStyle = edge(5);      // dividers: 5px from card edge
    const edgeStyleMd = edge(10);   // markdown: 10px from card edge

    // icon size/gap configurable; inline because of light DOM (see above)
    const iconSize = this._cssLen(this._config.icon_size, '24px');
    const iconGap  = this._cssLen(this._config.icon_gap, '8px');
    // note: mdi glyphs fill their box differently (mdi:thermometer is narrow,
    // mdi:menu wide) -> the whitespace lives INSIDE the SVG and varies per icon.
    // No auto compensation; balance visually via padding_left/right.
    const iconSizeStyle = '--mdc-icon-size:' + iconSize + ';width:' + iconSize + ';height:' + iconSize +
      ';min-width:' + iconSize + ';max-width:' + iconSize + ';flex:0 0 ' + iconSize + ';';
    const gapStyle = 'margin-inline-start:' + iconGap + ';';

    const htmlStr = rows.map((r, i) => {
      // divider: 1px in the card border color, fixed side gap to the card edge
      if (r.divider) {
        return '<div class="eec-divider" style="height:0;border-top:1px solid ' +
               'var(--ha-card-border-color,var(--divider-color,#7f7f7f));' + edgeStyle + '"></div>';
      }
      if (r.markdown !== undefined) {
        return '<div class="eec-md" data-md="' + i + '" style="' + edgeStyleMd +
          (r.mdAlign ? ('text-align:' + this._esc(r.mdAlign) + ';') : '') + '"></div>';
      }
      const hasName = String(r.name == null ? '' : r.name).trim().length > 0;
      // icon on the right: the gap moves to the icon itself
      const iconHtml =
        '<ha-icon class="eec-icon" icon="' + this._esc(r.icon) + '" style="' + iconSizeStyle +
          (r.iconRight ? gapStyle : '') +
          (r.color ? ('color:' + this._esc(r.color) + ';') : '') + '"></ha-icon>';
      const stateCls = 'eec-state' + (hasName ? '' : ' eec-state--inline') + (r.avail ? '' : ' eec-unavail');
      // without a name the value borders the icon -> apply the icon gap there (icon left only)
      const stateHtml = r.hideState ? '' :
        ('<div class="' + stateCls + '"' + ((hasName || r.iconRight) ? '' : (' style="' + gapStyle + '"')) + '>' +
         this._esc(r.stateStr) + '</div>');
      const infoHtml = hasName
        ? ('<div class="eec-info"' + (r.iconRight ? '' : (' style="' + gapStyle + '"')) + '>' + this._esc(r.name) + '</div>')
        : '';
      let inner;
      if (hasName) {
        inner = r.iconRight ? (infoHtml + stateHtml + iconHtml) : (iconHtml + infoHtml + stateHtml);
      } else {
        inner = r.iconRight
          ? (stateHtml + '<div class="eec-spacer"></div>' + iconHtml)
          : (iconHtml + stateHtml + '<div class="eec-spacer"></div>');
      }
      return '<div class="eec-row" data-i="' + i + '">' + inner + '</div>';
    }).join('');

    // anti-flicker: only touch the DOM when visible content actually changed
    this._rows = rows;
    if (htmlStr !== this._lastHtml) {
      this._lastHtml = htmlStr;
      this._body.innerHTML = htmlStr;
      this._applyMarkdown(rows);
    }
  }

  /** Subscribe a markdown element to live template rendering ({iobroker.id}).
   *  One subscription per row; re-created only when the template changes. */
  _ensureMdSubscription(idx, template, md) {
    this._mdSubs = this._mdSubs || {};
    const cur = this._mdSubs[idx];
    if (cur && cur.template === template) return;
    if (cur && cur.unsub) { cur.unsub.then(u => { try { u(); } catch (e) {} }).catch(() => {}); }
    const rec = { template: template, unsub: null };
    this._mdSubs[idx] = rec;
    try {
      rec.unsub = this._hass.connection.subscribeMessage(
        msg => {
          const r = (msg && msg.result != null) ? String(msg.result) : '';
          if (md.content !== r) md.content = r;
        },
        { type: 'render_template', template: template }
      );
      rec.unsub.catch(() => { if (md.content !== template) md.content = template; });
    } catch (e) {
      if (md.content !== template) md.content = template;   // static fallback
    }
  }

  _teardownMdSubs() {
    const subs = this._mdSubs || {};
    Object.keys(subs).forEach(k => {
      const rec = subs[k];
      if (rec && rec.unsub) rec.unsub.then(u => { try { u(); } catch (e) {} }).catch(() => {});
    });
    this._mdSubs = {};
  }

  disconnectedCallback() {
    // card removed from DOM (view switch): drop subscriptions, force rebuild on return
    this._teardownMdSubs();
    this._lastHtml = null;
    this._mdCache = {};
  }

  /** Fill markdown rows; ha-markdown elements are cached and REUSED on
   *  re-render (a DOM move keeps the rendered content -> no flash),
   *  content is only set when it changed. */
  _applyMarkdown(rows) {
    const self = this;
    this._mdCache = this._mdCache || {};
    const apply = () => {
      self._body.querySelectorAll('.eec-md').forEach(el => {
        const idx = el.dataset.md;
        const content = (rows[Number(idx)] || {}).markdown || '';
        if (customElements.get('ha-markdown')) {
          let md = self._mdCache[idx];
          if (!md || md.tagName !== 'HA-MARKDOWN') {
            md = document.createElement('ha-markdown');
            md.breaks = true;
            self._mdCache[idx] = md;
          }
          if (md.parentElement !== el) { el.innerHTML = ''; el.appendChild(md); }
          if (content.indexOf('{') !== -1) {
            // {iobroker.id} templates: resolved live via the adapter's
            // render_template subscription (same as the stock markdown card)
            self._ensureMdSubscription(idx, content, md);
          } else if (md.content !== content) {
            md.content = content;
          }
        } else {
          el.innerHTML = self._esc(content)
            .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
            .replace(/\*([^*]+)\*/g, '<i>$1</i>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;">')
            .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
        }
      });
    };
    apply();
    if (this._body.querySelector('.eec-md') && !customElements.get('ha-markdown')) {
      eecLoadMarkdown().then(apply);
    }
  }
}

customElements.define('enhanced-entities-card', EnhancedEntitiesCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'enhanced-entities-card',
  name: 'Enhanced Entities Card',
  description: 'Entities card with configurable icon colors, state-dependent icons/colors, gradients, dividers, markdown rows and fully adjustable spacing.'
});

/* ============================================================================
 * GUI-Editor v1.1 – mit Original-Pickern:
 *   ha-entity-picker (Datenpunkt-Suche) + ha-icon-picker (Icon-Suche)
 * ==========================================================================*/
EnhancedEntitiesCard.getConfigElement = function () {
  return document.createElement('enhanced-entities-card-editor');
};
EnhancedEntitiesCard.getStubConfig = function () {
  return { entities: [] };
};

/* Lazy-load picker elements: the stock entities editor registers
 * ha-entity-picker/ha-icon-picker. Triggering it once is enough. */
let _eecPickersLoaded = null;
function eecLoadPickers() {
  if (_eecPickersLoaded) return _eecPickersLoaded;
  _eecPickersLoaded = (async () => {
    if (customElements.get('ha-entity-picker') && customElements.get('ha-icon-picker')) return;
    try {
      const helpers = window.loadCardHelpers ? await window.loadCardHelpers() : null;
      if (helpers) {
        const card = await helpers.createCardElement({ type: 'entities', entities: [] });
        if (card && card.constructor && card.constructor.getConfigElement) {
          card.constructor.getConfigElement();
        }
      }
      await Promise.race([
        Promise.all([
          customElements.whenDefined('ha-entity-picker'),
          customElements.whenDefined('ha-icon-picker')
        ]),
        new Promise(res => setTimeout(res, 3000))
      ]);
    } catch (e) { /* fallback applies */ }
  })();
  return _eecPickersLoaded;
}

class EnhancedEntitiesCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = JSON.parse(JSON.stringify(config || {}));
    if (!Array.isArray(this._config.entities)) this._config.entities = [];
    const self = this;
    eecLoadPickers().then(() => self._render());
    this._render();
  }
  set hass(hass) {
    this._hass = hass;
    // hass an bereits gerenderte Picker durchreichen
    this.querySelectorAll('ha-entity-picker,ha-icon-picker').forEach(p => { p.hass = hass; });
    if (!this._rendered) this._render();
  }

  _fire() {
    const ev = new Event('config-changed', { bubbles: true, composed: true });
    ev.detail = { config: this._config };
    this.dispatchEvent(ev);
  }

  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  _modeOf(e) {
    if (Array.isArray(e.icon) || Array.isArray(e.icon_color)) return 'num';
    if ((e.icon && typeof e.icon === 'object') || (e.icon_color && typeof e.icon_color === 'object')) return 'bool';
    return 'static';
  }

  _hasPickers() {
    return !!(customElements.get('ha-entity-picker') && customElements.get('ha-icon-picker'));
  }

  /* Placeholders in HTML; real pickers are populated in _wire().
     Pickers bring their own material label (data-label),
     fallback inputs get a classic label above. */
  _entityField(val) {
    if (this._hasPickers()) return '<ha-entity-picker data-f="entity" data-label="Entity" data-val="' + this._esc(val) + '"></ha-entity-picker>';
    return '<label>Entity</label><input data-f="entity" list="eec-ents" value="' + this._esc(val) + '">';
  }
  _iconField(kind, field, val, label) {   // kind: 'f' (entity field) or 'rf' (rule field)
    if (this._hasPickers()) return '<ha-icon-picker data-' + kind + '="' + field + '" data-label="' + this._esc(label || 'Icon') + '" data-val="' + this._esc(val) + '"></ha-icon-picker>';
    return '<label>' + this._esc(label || 'Icon') + '</label><input data-' + kind + '="' + field + '" placeholder="mdi:..." value="' + this._esc(val) + '">';
  }

  _render() {
    if (!this._config) return;
    this._rendered = true;
    const c = this._config;
    const usePickers = this._hasPickers();
    const entOptions = (!usePickers && this._hass)
      ? Object.keys(this._hass.states).sort().map(id => '<option value="' + this._esc(id) + '">').join('')
      : '';

    let html =
      '<style>' +
      '.ed{padding:4px 0;font-family:inherit;}' +
      /* material "filled" fields like the stock editor: label INSIDE the
         field, filled background, underline, accent-colored focus line */
      '.ed .fld,.ed .grid2>div,.ed .grid3>div{' +
        'background:var(--mdc-text-field-fill-color,rgba(255,255,255,.06));' +
        'border-radius:4px 4px 0 0;' +
        'border-bottom:1px solid var(--mdc-text-field-idle-line-color,rgba(255,255,255,.4));' +
        'padding:7px 12px 5px;}' +
      '.ed .fld:focus-within,.ed .grid2>div:focus-within,.ed .grid3>div:focus-within{' +
        'border-bottom:2px solid var(--primary-color,#ff9800);padding-bottom:4px;}' +
      /* containers holding stock pickers: no own field design (picker brings its own) */
      '.ed .grid2>div:has(ha-icon-picker),.ed .grid3>div:has(ha-icon-picker),.ed .fld:has(ha-entity-picker)' +
        '{background:none;border-bottom:none;padding:0;}' +
      '.ed label{display:block;font-size:11px;color:var(--secondary-text-color);margin:0 0 2px;letter-spacing:.2px;}' +
      '.ed .sect{display:block;font-size:13px;font-weight:bold;color:var(--primary-text-color);margin:14px 0 6px;}' +
      '.ed input,.ed select{width:100%;box-sizing:border-box;padding:2px 0;background:transparent;' +
        'color:var(--primary-text-color);border:none;outline:none;font-size:14px;font-family:inherit;}' +
      '.ed select option{background:var(--card-background-color,#1c1c1c);}' +
      '.ed ha-entity-picker,.ed ha-icon-picker{display:block;width:100%;}' +
      '.ed .row{border:1px solid var(--divider-color,#444);border-radius:8px;padding:10px;margin:10px 0;}' +
      '.ed .rowhead{display:flex;align-items:center;gap:4px;margin-bottom:8px;}' +
      '.ed .rowhead b{flex:1;overflow:hidden;text-overflow:ellipsis;font-size:13px;font-weight:500;}' +
      '.ed button{background:none;border:none;color:var(--secondary-text-color);' +
        'border-radius:4px;padding:4px 8px;cursor:pointer;font-size:14px;line-height:1;}' +
      '.ed button:hover{background:rgba(127,127,127,.15);color:var(--primary-text-color);}' +
      '.ed .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;}' +
      '.ed .grid3{display:grid;grid-template-columns:80px 1fr 1fr 28px;gap:8px;align-items:end;margin-top:8px;}' +
      '.ed .add{margin-top:10px;width:100%;padding:8px;background:rgba(127,127,127,.1);' +
        'color:var(--primary-color,#ff9800);text-transform:uppercase;font-size:12px;letter-spacing:.6px;font-weight:500;}' +
      '.ed input[type=color]{padding:0;height:26px;border:none;background:transparent;cursor:pointer;}' +
      '.ed textarea{width:100%;box-sizing:border-box;padding:2px 0;background:transparent;color:var(--primary-text-color);' +
        'border:none;outline:none;font-size:14px;font-family:inherit;resize:vertical;}' +
      '.ed .chk{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px;color:var(--primary-text-color);cursor:pointer;}' +
      '.ed .chk input{width:auto;accent-color:var(--primary-color,#ff9800);}' +
      '.ed .colorwrap{display:flex;gap:6px;align-items:center;}' +
      '.ed .colorwrap input[type=text]{flex:1;}' +
      '.ed .colorwrap input[type=color]{flex:0 0 34px;}' +
      '</style><div class="ed">' +
      '<div class="fld"><label>Title (optional)</label>' +
      '<input id="ti" value="' + this._esc(c.title || '') + '"></div>' +
      '<span class="sect">Appearance (empty = default)</span>' +
      '<div class="grid2">' +
        '<div><label>Font size</label><input data-g="font_size" placeholder="e.g. 16px / inherit" value="' + this._esc(c.font_size || '') + '"></div>' +
        '<div><label>Row gap</label><input data-g="row_gap" placeholder="16px" value="' + this._esc(c.row_gap || '') + '"></div>' +
        '<div><label>Padding top</label><input data-g="padding_top" placeholder="8px" value="' + this._esc(c.padding_top || '') + '"></div>' +
        '<div><label>Padding bottom</label><input data-g="padding_bottom" placeholder="8px" value="' + this._esc(c.padding_bottom || '') + '"></div>' +
        '<div><label>Padding left</label><input data-g="padding_left" placeholder="16px" value="' + this._esc(c.padding_left || '') + '"></div>' +
        '<div><label>Padding right</label><input data-g="padding_right" placeholder="16px" value="' + this._esc(c.padding_right || '') + '"></div>' +
        '<div><label>Icon size</label><input data-g="icon_size" placeholder="24px" value="' + this._esc(c.icon_size || '') + '"></div>' +
        '<div><label>Icon gap (to text)</label><input data-g="icon_gap" placeholder="8px" value="' + this._esc(c.icon_gap || '') + '"></div>' +
      '</div>';

    c.entities.forEach((raw, i) => {
      const e = (typeof raw === 'string') ? { entity: raw } : raw;
      if (e && e.type === 'markdown') {
        html += '<div class="row" data-i="' + i + '">' +
          '<div class="rowhead"><b style="color:var(--secondary-text-color);">Markdown</b>' +
          '<button data-act="up" title="up">\u25b2</button>' +
          '<button data-act="down" title="down">\u25bc</button>' +
          '<button data-act="del" title="remove">\u2715</button></div>' +
          '<div class="fld"><label>Content (Markdown)</label>' +
          '<textarea data-f="md_content" rows="2">' + this._esc(e.content || '') + '</textarea></div>' +
          '<div class="grid2" style="margin-top:6px;"><div><label>Alignment</label><select data-f="md_align">' +
          '<option value=""' + (!e.align ? ' selected' : '') + '>Left</option>' +
          '<option value="center"' + (e.align === 'center' ? ' selected' : '') + '>Center</option>' +
          '<option value="right"' + (e.align === 'right' ? ' selected' : '') + '>Right</option>' +
          '</select></div></div></div>';
        return;
      }
      if (e && e.type === 'divider') {
        html += '<div class="row" data-i="' + i + '" style="padding:4px 10px;">' +
          '<div class="rowhead" style="margin-bottom:0;"><b style="color:var(--secondary-text-color);">\u2014 Divider \u2014</b>' +
          '<button data-act="up" title="up">\u25b2</button>' +
          '<button data-act="down" title="down">\u25bc</button>' +
          '<button data-act="del" title="remove">\u2715</button></div></div>';
        return;
      }
      const mode = this._modeOf(e);
      html +=
        '<div class="row" data-i="' + i + '">' +
        '<div class="rowhead"><b>' + this._esc(e.entity || '(new entity)') + '</b>' +
        '<button data-act="up" title="up">▲</button>' +
        '<button data-act="down" title="down">▼</button>' +
        '<button data-act="del" title="remove">✕</button></div>' +
        '<div class="fld">' + this._entityField(e.entity || '') + '</div>' +
        '<div class="grid2"><div><label>Tap action</label><select data-f="action">' +
        '<option value=""' + (!e.action ? ' selected' : '') + '>More info (default)</option>' +
        '<option value="toggle"' + (e.action === 'toggle' ? ' selected' : '') + '>Toggle</option>' +
        '<option value="none"' + (e.action === 'none' ? ' selected' : '') + '>None (read-only)</option>' +
        '</select></div><div><label>Icon position</label><select data-f="icon_position">' +
        '<option value=""' + (e.icon_position !== 'right' ? ' selected' : '') + '>Left (default)</option>' +
        '<option value="right"' + (e.icon_position === 'right' ? ' selected' : '') + '>Right</option>' +
        '</select></div></div>' +
        '<label class="chk"><input type="checkbox" data-f="hide_state"' + (e.hide_state ? ' checked' : '') + '>' +
        ' Hide state</label>' +
        '<div class="grid2"><div><label>Name (optional)</label><input data-f="name" value="' + this._esc(e.name || '') + '"></div>' +
        '<div><label>Icon/color mode</label><select data-f="mode">' +
        '<option value="static"' + (mode === 'static' ? ' selected' : '') + '>Static</option>' +
        '<option value="bool"' + (mode === 'bool' ? ' selected' : '') + '>By true/false</option>' +
        '<option value="num"' + (mode === 'num' ? ' selected' : '') + '>By numeric value</option>' +
        '</select></div></div>';

      if (mode === 'static') {
        html += '<div class="grid2">' +
          '<div>' + this._iconField('f', 'icon', typeof e.icon === 'string' ? e.icon : '', 'Icon') + '</div>' +
          '<div><label>Icon color</label>' + this._colorInput('icon_color', typeof e.icon_color === 'string' ? e.icon_color : '') + '</div></div>';
      } else if (mode === 'bool') {
        const ic = (e.icon && typeof e.icon === 'object' && !Array.isArray(e.icon)) ? e.icon : {};
        const co = (e.icon_color && typeof e.icon_color === 'object' && !Array.isArray(e.icon_color)) ? e.icon_color : {};
        html += '<div class="grid2">' +
          '<div>' + this._iconField('f', 'icon_t', ic['true'] || ic['on'] || '', 'Icon when true/on') + '</div>' +
          '<div><label>Color when true/on</label>' + this._colorInput('color_t', co['true'] || co['on'] || '') + '</div>' +
          '<div>' + this._iconField('f', 'icon_f', ic['false'] || ic['off'] || '', 'Icon when false/off') + '</div>' +
          '<div><label>Color when false/off</label>' + this._colorInput('color_f', co['false'] || co['off'] || '') + '</div></div>';
      } else {
        const rules = this._readRules(e);
        html += '<label>Rules (highest threshold ≤ value wins)</label>';
        rules.forEach((r, j) => {
          html += '<div class="grid3" data-rule="' + j + '">' +
            '<div><label>From value</label><input data-rf="value" type="number" step="any" value="' + this._esc(r.value) + '"></div>' +
            '<div>' + this._iconField('rf', 'icon', r.icon, 'Icon') + '</div>' +
            '<div><label>Color</label>' + this._colorInput('rcolor', r.color, true) + '</div>' +
            '<button data-act="ruledel" data-j="' + j + '" title="remove rule">✕</button></div>';
        });
        html += '<button class="add" data-act="ruleadd">+ Rule</button>' +
          '<label class="chk"><input type="checkbox" data-f="color_gradient"' + (e.color_gradient ? ' checked' : '') + '>' +
          ' Color gradient between thresholds</label>';
      }
      html += '</div>';
    });

    html += '<button class="add" data-act="addent">+ Add entity</button>' +
            '<button class="add" data-act="adddiv">+ Add divider</button>' +
            '<button class="add" data-act="addmd">+ Add markdown row</button>' +
            (usePickers ? '' : '<datalist id="eec-ents">' + entOptions + '</datalist>') + '</div>';

    this.innerHTML = html;
    this._wire();
  }

  _colorInput(field, val, isRule) {
    const hex = /^#[0-9a-fA-F]{6}$/.test(val || '') ? val : '#44739e';
    return '<div class="colorwrap">' +
      '<input type="text" data-' + (isRule ? 'rf' : 'f') + '="' + field + '" placeholder="#rrggbb / empty" value="' + this._esc(val || '') + '">' +
      '<input type="color" data-pick="' + field + '" value="' + hex + '"></div>';
  }

  _readRules(e) {
    const icons = Array.isArray(e.icon) ? e.icon : [];
    const colors = Array.isArray(e.icon_color) ? e.icon_color : [];
    const vals = [...new Set([...icons.map(r => r.value), ...colors.map(r => r.value)])].sort((a, b) => a - b);
    const rules = vals.map(v => ({
      value: v,
      icon: (icons.find(r => Number(r.value) === Number(v)) || {}).icon || '',
      color: (colors.find(r => Number(r.value) === Number(v)) || {}).color || ''
    }));
    if (!rules.length) rules.push({ value: 0, icon: '', color: '' });
    return rules;
  }

  /* shared value handler for inputs AND pickers */
  _applyField(i, f, v) {
    const c = this._config;
    if (typeof c.entities[i] === 'string') c.entities[i] = { entity: c.entities[i] };
    const e = c.entities[i];
    if (f === 'entity') { e.entity = v; }
    else if (f === 'name') { if (v) e.name = v; else delete e.name; }
    else if (f === 'mode') {
      if (v === 'static') { delete e.icon; delete e.icon_color; }
      else if (v === 'bool') { e.icon = { 'true': '', 'false': '' }; e.icon_color = { 'true': '', 'false': '' }; }
      else { e.icon = [{ value: 0, icon: '' }]; e.icon_color = [{ value: 0, color: '' }]; }
      this._render();
    }
    else if (f === 'icon') { if (v) e.icon = v; else delete e.icon; }
    else if (f === 'icon_color') { if (v) e.icon_color = v; else delete e.icon_color; }
    else if (f === 'color_gradient') { if (v) e.color_gradient = true; else delete e.color_gradient; }
    else if (f === 'md_content') { e.content = v; }
    else if (f === 'md_align') { if (v) e.align = v; else delete e.align; }
    else if (f === 'action') { if (v) e.action = v; else delete e.action; }
    else if (f === 'icon_position') { if (v) e.icon_position = v; else delete e.icon_position; }
    else if (f === 'hide_state') { if (v) e.hide_state = true; else delete e.hide_state; }
    else if (f === 'icon_t' || f === 'icon_f') {
      if (typeof e.icon !== 'object' || Array.isArray(e.icon)) e.icon = {};
      e.icon[f === 'icon_t' ? 'true' : 'false'] = v;
    }
    else if (f === 'color_t' || f === 'color_f') {
      if (typeof e.icon_color !== 'object' || Array.isArray(e.icon_color)) e.icon_color = {};
      e.icon_color[f === 'color_t' ? 'true' : 'false'] = v;
    }
    this._fire();
  }

  _applyRuleField(i, j, rf, v) {
    const c = this._config;
    if (typeof c.entities[i] === 'string') c.entities[i] = { entity: c.entities[i] };
    const e = c.entities[i];
    const rules = this._readRules(e);
    const r = rules[j] || (rules[j] = { value: 0, icon: '', color: '' });
    if (rf === 'value') r.value = Number(v);
    if (rf === 'icon') r.icon = v;
    if (rf === 'rcolor') r.color = v;
    this._writeRules(e, rules);
    this._fire();
  }

  _writeRules(e, rules) {
    // keep ALL rules (even with empty icon/color), otherwise the mode flips
    // back to "static" while editing and new rows vanish.
    if (!rules.length) rules = [{ value: 0, icon: '', color: '' }];
    e.icon = rules.map(r => ({ value: r.value, icon: r.icon || '' }));
    e.icon_color = rules.map(r => ({ value: r.value, color: r.color || '' }));
  }

  _wire() {
    const self = this;
    const c = this._config;

    this.querySelector('#ti').onchange = function () {
      if (this.value) c.title = this.value; else delete c.title;
      self._fire();
    };
    // global appearance options: empty = remove option (default)
    this.querySelectorAll('input[data-g]').forEach(inp => {
      inp.onchange = function () {
        const f = inp.dataset.g;
        const v = inp.value.trim();
        if (v) c[f] = v; else delete c[f];
        self._fire();
      };
    });
    this.querySelectorAll('[data-act="addent"]').forEach(b => b.onclick = function () {
      c.entities.push({ entity: '' }); self._render(); self._fire();
    });
    this.querySelectorAll('[data-act="adddiv"]').forEach(b => b.onclick = function () {
      c.entities.push({ type: 'divider' }); self._render(); self._fire();
    });
    this.querySelectorAll('[data-act="addmd"]').forEach(b => b.onclick = function () {
      c.entities.push({ type: 'markdown', content: '' }); self._render(); self._fire();
    });

    this.querySelectorAll('.row').forEach(row => {
      const i = Number(row.dataset.i);

      row.querySelectorAll('button[data-act]').forEach(b => {
        b.onclick = function () {
          const act = b.dataset.act;
          if (act === 'del') { c.entities.splice(i, 1); }
          else if (act === 'up' && i > 0) { const t = c.entities[i - 1]; c.entities[i - 1] = c.entities[i]; c.entities[i] = t; }
          else if (act === 'down' && i < c.entities.length - 1) { const t = c.entities[i + 1]; c.entities[i + 1] = c.entities[i]; c.entities[i] = t; }
          else if (act === 'ruleadd' || act === 'ruledel') {
            if (typeof c.entities[i] === 'string') c.entities[i] = { entity: c.entities[i] };
            const e = c.entities[i];
            const rules = self._readRules(e);
            if (act === 'ruleadd') {
              // unique threshold, otherwise the row is swallowed by the merge
              const mx = rules.reduce((m, r) => Math.max(m, Number(r.value) || 0), 0);
              rules.push({ value: mx + 1, icon: '', color: '' });
            }
            else rules.splice(Number(b.dataset.j), 1);
            self._writeRules(e, rules);
          }
          else return;
          self._render(); self._fire();
        };
      });

      // Einfache Inputs/Selects
      row.querySelectorAll('input[data-f],select[data-f],textarea[data-f]').forEach(inp => {
        inp.onchange = function () {
          self._applyField(i, inp.dataset.f, inp.type === 'checkbox' ? inp.checked : inp.value);
        };
      });
      // Original-Picker (Entity + Icons): hass/value setzen, value-changed
      row.querySelectorAll('ha-entity-picker[data-f],ha-icon-picker[data-f]').forEach(pk => {
        pk.hass = self._hass;
        pk.value = pk.dataset.val || '';
        pk.label = pk.dataset.label || '';
        pk.allowCustomEntity = true;
        pk.addEventListener('value-changed', ev => {
          self._applyField(i, pk.dataset.f, (ev.detail && ev.detail.value) || '');
        });
      });

      // numeric rules
      row.querySelectorAll('[data-rule]').forEach(rr => {
        const j = Number(rr.dataset.rule);
        rr.querySelectorAll('input[data-rf]').forEach(inp => {
          inp.onchange = function () { self._applyRuleField(i, j, inp.dataset.rf, inp.value); };
        });
        rr.querySelectorAll('ha-icon-picker[data-rf]').forEach(pk => {
          pk.hass = self._hass;
          pk.value = pk.dataset.val || '';
          pk.label = pk.dataset.label || '';
          pk.addEventListener('value-changed', ev => {
            self._applyRuleField(i, j, pk.dataset.rf, (ev.detail && ev.detail.value) || '');
          });
        });
      });

      // mirror the color picker into the text field
      row.querySelectorAll('input[type=color][data-pick]').forEach(pk => {
        pk.oninput = function () {
          const txt = pk.parentElement.querySelector('input[type=text]');
          txt.value = pk.value;
          txt.onchange();
        };
      });
    });
  }
}

customElements.define('enhanced-entities-card-editor', EnhancedEntitiesCardEditor);
