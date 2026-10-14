/* The Missing Days
   Embeds each chart, sizes it to its grid cell and builds the data table under it.
   Every chart's JSON in /specs also renders on its own (for example in the Vega editor). */
(function () {
  'use strict';

  const FONT = 'Lexend, system-ui, -apple-system, "Segoe UI", sans-serif';
  const INK = '#1f1f1f';
  const INK_2 = '#5a5a5a';
  const HAIRLINE = '#e1e0d9';
  const AXIS = '#c3c2b7';

  // Shared look. Vega-Lite and Vega use different config shapes, so there are two.
  const VL_CONFIG = {
    background: null,
    font: FONT,
    view: { stroke: null },
    axis: {
      labelFontSize: 12, titleFontSize: 12, labelColor: INK_2, titleColor: INK_2,
      titleFontWeight: 'normal', domainColor: AXIS, tickColor: AXIS, gridColor: HAIRLINE,
    },
    legend: { labelFontSize: 12, titleFontSize: 12, labelColor: INK_2, titleColor: INK, titleFontWeight: 'bold' },
    text: { fontSize: 13, color: INK },
  };
  const VG_CONFIG = {
    background: null,
    text: { font: FONT },
    legend: {
      labelFont: FONT, titleFont: FONT, labelFontSize: 12, titleFontSize: 12,
      labelColor: INK_2, titleColor: INK, titleFontWeight: 'bold',
    },
  };

  // One entry per chart, in page order.
  const CHARTS = [
    { id: 'c16', spec: 'specs/c16_dorling.vg.json', mode: 'vega', bind: 'c16-controls' },
    { id: 'c2', spec: 'specs/c02_trend.vl.json', mode: 'vega-lite' },
    { id: 'c3', spec: 'specs/c03_heatmap.vl.json', mode: 'vega-lite' },
    // C4 and C5 share one year control (rendered from C4's binding) and highlight each other's hovered region.
    { id: 'c4', spec: 'specs/c04_choropleth.vl.json', mode: 'vega-lite', bind: 'where-controls' },
    { id: 'c5', spec: 'specs/c05_symbols.vl.json', mode: 'vega-lite', bind: 'c5-bindings' },
    { id: 'c7', spec: 'specs/c07_dumbbell.vl.json', mode: 'vega-lite' },
    { id: 'c13', spec: 'specs/c13_treemap.vg.json', mode: 'vega' },
    { id: 'c9', spec: 'specs/c09_dotplot.vl.json', mode: 'vega-lite' },
    // C12 drives C10 and C15: clicking an ICSEA group filters both maps.
    { id: 'c12', spec: 'specs/c12_boxplot.vl.json', mode: 'vega-lite' },
    { id: 'c10', spec: 'specs/c10_dotmap.vg.json', mode: 'vega' },
    { id: 'c15', spec: 'specs/c15_binmap.vl.json', mode: 'vega-lite' },
  ];

  async function embed(chart) {
    const el = document.getElementById(`${chart.id}-vis`);
    try {
      const result = await vegaEmbed(el, chart.spec, {
        mode: chart.mode,
        renderer: 'svg',
        actions: false,
        config: chart.mode === 'vega' ? VG_CONFIG : VL_CONFIG,
        bind: chart.bind ? document.getElementById(chart.bind) : undefined,
        tooltip: { theme: 'custom' },
      });
      if (chart.mode === 'vega') fitWidth(result.view, el);
      return result.view;
    } catch (err) {
      el.innerHTML = '<p class="chart-error">Sorry, this chart could not be loaded. The data table below shows the same numbers.</p>';
      console.error(`Chart ${chart.id} failed`, err);
      return null;
    }
  }

  // Vega-Lite specs use width "container"; Vega specs get their width from the grid cell here.
  function fitWidth(view, el) {
    const apply = () => {
      const w = Math.floor(el.clientWidth);
      if (w > 0 && w !== view.width()) view.width(w).runAsync();
    };
    apply();
    new ResizeObserver(apply).observe(el);
  }

  // "Data table" disclosures: built from the chart's CSV the first time they are opened.
  function initDataTables() {
    document.querySelectorAll('details.data-table[data-src]').forEach(details => {
      details.addEventListener('toggle', () => { if (details.open) loadTable(details); });
      if (details.open) loadTable(details);
    });
  }

  async function loadTable(details) {
    if (details.dataset.loaded) return;
    details.dataset.loaded = 'true';
    const [filterField, filterValue] = (details.dataset.filter || '').split('=');
    try {
      const text = await vega.loader().load(details.dataset.src);
      let rows = vega.read(text, { type: 'csv', parse: 'auto' })
        .filter(r => !filterField || String(r[filterField]) === filterValue);
      let columns;
      if (details.dataset.pivot) {
        [columns, rows] = pivot(details.dataset, rows);
      } else {
        // data-cols: "field:Label" or "field:Label:decimals", separated by "|"
        columns = details.dataset.cols.split('|').map(c => {
          const [field, label, dp] = c.split(':');
          return { field, label, dp: dp === undefined ? null : Number(dp) };
        });
      }
      // The wrapper scrolls sideways on narrow screens so the page itself never does.
      const scroller = document.createElement('div');
      scroller.className = 'table-scroll';
      scroller.appendChild(buildTable(columns, rows));
      details.appendChild(scroller);
    } catch (err) {
      details.insertAdjacentHTML('beforeend', '<p>The data could not be loaded.</p>');
      console.error('Data table failed', err);
    }
  }

  // data-pivot="rowField|columnField|valueField": a wide table, one row per rowField value
  // and one column per columnField value (for example year levels down, years across).
  function pivot(opts, rows) {
    const [rowField, colField, valueField] = opts.pivot.split('|');
    const uniq = f => [...new Set(rows.map(r => r[f]))].sort((a, b) => a - b);
    const dp = opts.dp === undefined ? null : Number(opts.dp);
    const columns = [{ field: '_row', label: opts.rowTitle || rowField, dp: null }]
      .concat(uniq(colField).map(c => ({ field: 'v' + c, label: String(c), dp })));
    const wide = uniq(rowField).map(rv => {
      const out = { _row: (opts.rowPrefix || '') + rv };
      rows.filter(r => r[rowField] === rv).forEach(r => { out['v' + r[colField]] = r[valueField]; });
      return out;
    });
    return [columns, wide];
  }

  function buildTable(columns, rows) {
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    columns.forEach(c => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = c.label;
      head.appendChild(th);
    });
    const body = table.createTBody();
    rows.forEach(r => {
      const tr = body.insertRow();
      columns.forEach(c => { tr.insertCell().textContent = formatCell(r[c.field], c); });
    });
    return table;
  }

  function formatCell(v, column) {
    if (v === null || v === undefined || v === '') return '–';
    if (typeof v !== 'number' || /year/i.test(column.field)) return String(v);
    if (column.dp !== null) return v.toLocaleString('en-AU', { minimumFractionDigits: column.dp, maximumFractionDigits: column.dp });
    return v.toLocaleString('en-AU');
  }

  // Linked views: a parameter changed in one chart is copied into the others.
  // "sync" copies the same signal (a shared control); "hover" copies a hovered key into "linked".
  const LINKS = [
    { type: 'sync', signal: 'year', views: ['c4', 'c5'] },
    { type: 'hover', views: ['c4', 'c5'] },
    { type: 'select', from: 'c12', selection: 'pick', field: 'icsea_band', target: 'band', to: ['c10', 'c15'] },
  ];

  function wireLinks(views) {
    LINKS.filter(l => l.type === 'select').forEach(link => wireSelection(link, views));
    LINKS.filter(l => l.type !== 'select').forEach(link => {
      const linked = link.views.map(id => [id, views[id]]).filter(([, v]) => v);
      if (linked.length < 2) return;
      linked.forEach(([id, view]) => {
        if (link.type === 'sync') {
          view.addSignalListener(link.signal, (name, value) => {
            linked.forEach(([other, v]) => {
              if (other !== id && v.signal(link.signal) !== value) v.signal(link.signal, value).runAsync();
            });
          });
        } else {
          view.addSignalListener('hover', (name, value) => {
            const key = value && value.key ? [].concat(value.key)[0] : '';
            linked.forEach(([other, v]) => { if (other !== id) v.signal('linked', key || '').runAsync(); });
          });
        }
      });
    });
  }

  // A click selection in one chart becomes a plain value ("" = everything) in others,
  // with a status line and a reset button for the reader.
  function wireSelection(link, views) {
    const source = views[link.from];
    const targets = link.to.map(id => views[id]).filter(Boolean);
    if (!source) return;
    const status = document.getElementById('nsw-status');
    const clear = document.getElementById('nsw-clear');
    const apply = value => {
      targets.forEach(v => v.signal(link.target, value).runAsync());
      if (status) status.innerHTML = value ? 'Both maps: only schools with ICSEA <strong>' + value.toLowerCase() + '</strong>' : 'Both maps: all schools';
      if (clear) clear.hidden = !value;
    };
    source.addSignalListener(link.selection, (name, value) => {
      const picked = value && value[link.field] ? [].concat(value[link.field])[0] : '';
      apply(picked || '');
    });
    if (clear) clear.addEventListener('click', () => {
      source.data(link.selection + '_store', []).runAsync();
      apply('');
    });
  }

  initDataTables();
  // Wait for the web fonts so Vega measures labels in the right typeface.
  document.fonts.ready.then(async () => {
    const results = await Promise.all(CHARTS.map(embed));
    const views = {};
    CHARTS.forEach((c, i) => { views[c.id] = results[i]; });
    wireLinks(views);
  });
})();
