/* vgr_D3 — delade hjälpfunktioner för alla diagramtyper (kräver D3 v7).
 *
 * Varje widget består av en <div id="..."> och en <script type="application/json" id="...-spec">
 * som R har skrivit. vgrD3.render(id) läser spec:en och anropar vgrD3.renderers[spec.typ].
 * Allt som ska synas vid export ritas i SVG:en; knappar/reglage ligger i HTML ovanför.
 */
(function () {
  "use strict";
  var vgrD3 = window.vgrD3 = window.vgrD3 || {};
  vgrD3.renderers = vgrD3.renderers || {};

  // ---------------------------------------------------------------------------
  //  Svensk formatering
  // ---------------------------------------------------------------------------
  var localeCache = {};
  vgrD3.locale = function (thousands) {
    var key = thousands == null ? "__none" : thousands;
    if (!localeCache[key]) {
      localeCache[key] = d3.formatLocale({
        decimal: ",", thousands: thousands == null ? "" : thousands, grouping: [3],
        currency: ["", " kr"], minus: "-", percent: " %", nan: "–"
      });
    }
    return localeCache[key];
  };

  // R:s round() avrundar exakta halvor till jämnt tal (2,5 -> 2), JavaScript uppåt (-> 3).
  // Avrunda först som R så att etiketterna blir desamma som i ggplot-versionerna.
  // Samma algoritm som R:s round() (R >= 4.0.0, src/nmath/fround.c): de två kandidaterna nedåt/uppåt jämförs
  // med flyttalsavstånd till x, och vid lika avstånd väljs den jämna (3,45 -> 3,5 men 80,45 -> 80,4; 0,15 -> 0,1).
  vgrD3.roundHalfEven = function (value, d) {
    if (!isFinite(value) || value === 0) return value;
    if (value < 0) return -vgrD3.roundHalfEven(-value, d);
    if (!d) {   // nearbyint: halvor till jämnt
      var f = Math.floor(value), rest = value - f;
      return rest > 0.5 || (rest === 0.5 && f % 2 !== 0) ? f + 1 : f;
    }
    var e = Math.floor(Math.log2(value));   // logb(): exakt exponent (log2 avrundar strax under en tvåpotens)
    if (Math.pow(2, e) > value) e--; else if (Math.pow(2, e + 1) <= value) e++;
    if (Math.LOG10E * Math.LN2 * (0.5 + e) + d > 15) return value;   // DBL_DIG
    var p = Math.pow(10, d), x10 = p * value, i10 = Math.floor(x10);
    var xd = i10 / p, xu = Math.ceil(x10) / p;
    var du = xu - value, dd = value - xd;
    return du < dd || (du === dd && i10 % 2 === 1) ? xu : xd;
  };

  // Samma resultat som format(round(x, d), nsmall = d, big.mark = ..., decimal.mark = ",") i R
  vgrD3.fmt = function (value, decimals, thousands) {
    if (value === null || value === undefined || isNaN(value)) return "–";
    var d = decimals == null ? 0 : decimals;
    var t = thousands === undefined ? " " : thousands;
    return vgrD3.locale(t).format((t == null ? "" : ",") + "." + d + "f")(vgrD3.roundHalfEven(value, d));
  };

  vgrD3.timeLocale = d3.timeFormatLocale({
    dateTime: "%A %e %B %Y kl. %X", date: "%Y-%m-%d", time: "%H:%M:%S", periods: ["fm", "em"],
    days: ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"],
    shortDays: ["sön", "mån", "tis", "ons", "tor", "fre", "lör"],
    months: ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"],
    shortMonths: ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]
  });

  vgrD3.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // ---------------------------------------------------------------------------
  //  CSS för HTML-delarna (tooltip, knappar). Läggs in en gång per sida.
  // ---------------------------------------------------------------------------
  if (!document.getElementById("vgr-d3-style")) {
    var css = [
      ".vgr-d3-container{position:relative;box-sizing:border-box;}",
      ".vgr-d3-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:6px 4px;font-size:13px;}",
      ".vgr-d3-controls button{font:inherit;padding:4px 10px;border:1px solid #b0bec5;background:#fff;color:#37474F;border-radius:4px;cursor:pointer;}",
      ".vgr-d3-controls button:hover{background:#eceff1;}",
      ".vgr-d3-controls button.vgr-active{background:#37474F;color:#fff;border-color:#37474F;}",
      ".vgr-d3-controls .vgr-group{display:inline-flex;gap:0;}",
      ".vgr-d3-controls .vgr-group button{border-radius:0;margin-left:-1px;}",
      ".vgr-d3-controls .vgr-group button:first-child{border-radius:4px 0 0 4px;margin-left:0;}",
      ".vgr-d3-controls .vgr-group button:last-child{border-radius:0 4px 4px 0;}",
      ".vgr-d3-controls input[type=search]{font:inherit;padding:4px 8px;border:1px solid #b0bec5;border-radius:4px;width:170px;}",
      // Kartornas sökruta: kryss som tömmer rutan, webbläsarens eget kryss (Chrome/Edge) dolt
      ".vgr-d3-controls .vgr-search{position:relative;display:inline-block;}",
      ".vgr-d3-controls .vgr-search input[type=search]{padding-right:28px;}",
      ".vgr-d3-controls input[type=search]::-webkit-search-cancel-button{-webkit-appearance:none;display:none;}",
      ".vgr-d3-controls .vgr-search-clear{position:absolute;right:4px;top:50%;transform:translateY(-50%);display:flex;",
      "align-items:center;justify-content:center;width:20px;height:20px;min-height:0;padding:0;margin:0;border:0;",
      "border-radius:50%;background:#cfd8dc;color:#37474F;font:bold 15px/1 Arial,sans-serif;cursor:pointer;}",
      ".vgr-d3-controls .vgr-search-clear:hover,.vgr-d3-controls .vgr-search-clear:focus-visible{background:#90a4ae;color:#fff;}",
      ".vgr-d3-controls .vgr-search-clear[hidden]{display:none;}",
      // Sökrutans förslagslista (egen, eftersom <datalist> inte visas som lista i många mobiler)
      ".vgr-d3-controls .vgr-search-list{position:absolute;left:0;top:100%;z-index:20;margin:2px 0 0;padding:2px 0;",
      "list-style:none;min-width:100%;width:max-content;max-width:min(420px,calc(100vw - 32px));max-height:min(300px,50vh);overflow-y:auto;",
      // Scrollning i listan (även med fingret) scrollar inte sidan när listans slut nås
      "overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;",
      "background:#fff;border:1px solid #b0bec5;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.18);text-align:left;}",
      ".vgr-d3-controls .vgr-search-list[hidden]{display:none;}",
      ".vgr-d3-controls .vgr-search-list li{padding:5px 10px;cursor:pointer;white-space:nowrap;overflow:hidden;",
      "text-overflow:ellipsis;font-size:13px;line-height:1.3;color:#263238;}",
      ".vgr-d3-controls .vgr-search-list li.vgr-forslag:hover,.vgr-d3-controls .vgr-search-list li.vgr-aktiv{background:#eceff1;}",
      ".vgr-d3-controls .vgr-search-list li.vgr-search-more{cursor:default;color:#607d8b;font-style:italic;white-space:normal;}",
      // Pekskärmar: större knappar, sökruta och förslag att träffa med fingret
      "@media (pointer:coarse){.vgr-d3-controls button:not(.vgr-search-clear),.vgr-d3-controls input[type=search]{min-height:36px;}",
      ".vgr-d3-controls .vgr-search-clear{width:26px;height:26px;}",
      ".vgr-d3-controls .vgr-search-list li{padding:10px 12px;font-size:15px;}}",
      ".vgr-d3-controls input[type=range]{width:180px;accent-color:#37474F;}",
      // Reglage med två handtag (startår och slutår i kartans förändringsläge): två
      // genomskinliga range-fält ovanpå varandra där bara handtagen tar emot musen
      ".vgr-d3-controls .vgr-range{position:relative;display:inline-block;width:180px;height:22px;}",
      ".vgr-d3-controls .vgr-range-track,.vgr-d3-controls .vgr-range-fill{position:absolute;top:9px;height:4px;border-radius:2px;}",
      ".vgr-d3-controls .vgr-range-track{left:7px;right:7px;background:#cfd8dc;}",
      ".vgr-d3-controls .vgr-range-fill{background:#37474F;}",
      ".vgr-d3-controls .vgr-range input[type=range]{position:absolute;left:0;top:0;width:100%;height:22px;margin:0;z-index:2;",
      "-webkit-appearance:none;appearance:none;background:transparent;pointer-events:none;}",
      ".vgr-d3-controls .vgr-range input[type=range]::-webkit-slider-runnable-track{height:22px;background:transparent;}",
      ".vgr-d3-controls .vgr-range input[type=range]::-moz-range-track{background:transparent;}",
      ".vgr-d3-controls .vgr-range input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;pointer-events:auto;cursor:pointer;",
      "width:14px;height:14px;margin-top:4px;border-radius:50%;background:#37474F;border:2px solid #fff;box-shadow:0 0 0 1px #37474F;box-sizing:border-box;}",
      ".vgr-d3-controls .vgr-range input[type=range]::-moz-range-thumb{pointer-events:auto;cursor:pointer;",
      "width:14px;height:14px;border-radius:50%;background:#37474F;border:2px solid #fff;box-shadow:0 0 0 1px #37474F;box-sizing:border-box;}",
      ".vgr-d3-controls .vgr-spacer{flex:1;}",
      ".vgr-d3-controls .vgr-year{min-width:44px;font-weight:bold;color:#37474F;}",
      ".vgr-d3-tooltip{position:absolute;pointer-events:none;background:#fff;border:1px solid #cfd8dc;border-radius:6px;",
      "box-shadow:0 2px 8px rgba(0,0,0,.15);padding:8px 10px;font-size:13px;color:#263238;max-width:340px;z-index:10;transition:opacity .12s;}",
      // Smala skärmar: tooltipen får inte bli bredare än skärmen
      "@media (max-width:480px){.vgr-d3-tooltip{max-width:calc(100vw - 32px);}}",
      ".vgr-d3-tooltip .vgr-tt-title{font-weight:bold;font-size:14px;margin-bottom:2px;}",
      ".vgr-d3-tooltip .vgr-tt-sub{color:#607d8b;margin-bottom:6px;}",
      ".vgr-d3-tooltip .vgr-tt-row{display:flex;justify-content:space-between;align-items:baseline;gap:14px;line-height:1.5;}",
      ".vgr-d3-tooltip .vgr-tt-row span{color:#546e7a;}",
      ".vgr-d3-tooltip .vgr-tt-row b{white-space:nowrap;text-align:right;}",
      ".vgr-d3-tooltip .vgr-tt-swatch{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:middle;}"
    ].join("\n");
    var st = document.createElement("style");
    st.id = "vgr-d3-style";
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ---------------------------------------------------------------------------
  //  Text i SVG
  // ---------------------------------------------------------------------------
  // Dold sida (t.ex. en reveal.js-bild som inte visas): SVG-texten mäts till 0. Då mäts texten i
  // stället med en canvas, som fungerar även utan layout.
  var measureCanvas = null;
  function canvasTextWidth(text, size, font, weight) {
    if (!measureCanvas) measureCanvas = document.createElement("canvas").getContext("2d");
    measureCanvas.font = (weight || "normal") + " " + size + "px " + (font || "sans-serif");
    return measureCanvas.measureText(String(text)).width;
  }

  vgrD3.measureText = function (svg, text, size, font, weight) {
    var t = svg.append("text").attr("x", -9999).attr("y", -9999)
      .style("font-family", font).style("font-size", size + "px").style("font-weight", weight || "normal")
      .text(text);
    var w = t.node().getComputedTextLength();
    t.remove();
    if (!w && text != null && String(text).trim() !== "") w = canvasTextWidth(text, size, font, weight);
    return w;
  };

  // Bredden på ett ritat text-element (största raden om det har tspan-rader), med samma reserv som ovan
  vgrD3.nodeTextWidth = function (node) {
    var tspans = node.querySelectorAll("tspan");
    var w = tspans.length > 1 ? node.getBBox().width : node.getComputedTextLength();
    if (w > 0 || !String(node.textContent).trim()) return w;
    var cs = window.getComputedStyle(node);
    var size = parseFloat(cs.fontSize) || 12;
    var lines = tspans.length > 1 ? [].map.call(tspans, function (s) { return s.textContent; }) : [node.textContent];
    return d3.max(lines, function (s) { return canvasTextWidth(s, size, cs.fontFamily, cs.fontWeight); }) || 0;
  };

  // Ritar rader under varandra med överkanten vid opt.y. Returnerar höjden.
  vgrD3.textBlock = function (parent, lines, opt) {
    if (!lines || !lines.length) return 0;
    var lh = opt.size * (opt.lineHeight || 1.2);
    var t = parent.append("text")
      .attr("class", opt.cls || null)
      .attr("text-anchor", opt.anchor || "middle")
      .attr("fill", opt.color || "#000")
      .style("font-family", opt.font)
      .style("font-size", opt.size + "px")
      .style("font-weight", opt.weight || "normal");
    lines.forEach(function (line, i) {
      t.append("tspan").attr("x", opt.x).attr("y", opt.y + opt.size * 0.92 + i * lh).text(line);
    });
    return lines.length * lh;
  };

  // ---------------------------------------------------------------------------
  //  Dataetiketter: rita, flytta isär, ledarlinjer (delas av linje/stapel/dumbbell)
  // ---------------------------------------------------------------------------
  function clamp(v, lo, hi) { return lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)); }
  vgrD3.clamp = clamp;

  // Breddar en axeldomän så att etiketter som ligger mitt på sina punkter ryms: halfLo/halfHi px utanför den
  // lägsta (lo) / högsta (hi) etikettpositionen, i dataenheter. Skalan krymper när domänen växer, så det
  // upprepas (10 varv). Tak: datan behåller minst halva axeln (det extra delas i proportion till behovet).
  // fix.lo / fix.hi låser den sidan (angiven axelgräns). Används av linje- och stapeldiagram
  vgrD3.padDomain = function (base, lo, hi, halfLo, halfHi, lenPx, fix) {
    fix = fix || {};
    if (!(lenPx > 0)) return base.slice();   // ingen axellängd (t.ex. en panel utan bredd): ingen breddning
    var span = base[1] - base[0], d = base.slice();
    for (var i = 0; i < 10; i++) {
      var perPx = (d[1] - d[0]) / lenPx;   // dataenheter per pixel
      d = [fix.lo ? base[0] : Math.min(base[0], lo - halfLo * perPx), fix.hi ? base[1] : Math.max(base[1], hi + halfHi * perPx)];
      if (d[1] - d[0] > 2 * span) {
        var extra = d[1] - d[0] - 2 * span, room = (base[0] - d[0]) + (d[1] - base[1]);
        d[0] += extra * (base[0] - d[0]) / room; d[1] -= extra * (d[1] - base[1]) / room;
      }
    }
    return d;
  };

  // items: [{text, x, y, color?, bold?}] — mäter och sätter d.w/d.h. o: size, font, color, box,
  // box_color, box_alpha, glow, glow_color, glow_width. Returnerar {g, place()}.
  vgrD3.labelNodes = function (parent, items, o) {
    var pad = o.box ? o.size * 0.25 : 1;
    var g = parent.selectAll(null).data(items).enter().append("g").attr("pointer-events", "none");
    var rect = o.box ? g.append("rect") : null;
    var txt = g.append("text")
      .attr("text-anchor", "middle").attr("dy", "0.35em")
      .attr("fill", function (d) { return d.color || o.color || "#000"; })
      .style("font-size", o.size + "px").style("font-family", o.font)
      .style("font-weight", function (d) { return d.bold ? "bold" : null; })
      .each(function (d) {
        // Radbrytningar ("\n") blir tspan-rader, centrerade kring etikettens mitt
        var lines = String(d.text).split("\n");
        d.nLines = lines.length;
        var t = d3.select(this);
        if (lines.length === 1) { t.text(lines[0]); return; }
        lines.forEach(function (line, i) {
          t.append("tspan").attr("x", 0)
            .attr("dy", i === 0 ? (-(lines.length - 1) * 0.6 + "em") : "1.2em")   // text-elementet har redan dy 0.35em
            .text(line);
        });
      });
    if (o.glow) {
      txt.attr("stroke", o.glow_color).attr("stroke-width", o.glow_width)
        .attr("stroke-linejoin", "round").attr("stroke-opacity", 0.85).attr("paint-order", "stroke");
    }
    txt.each(function (d) {
      d.w = vgrD3.nodeTextWidth(this) + 2 * pad;
      d.h = o.size * 1.2 * d.nLines + 2 * pad;
    });
    if (rect) {
      rect.attr("x", function (d) { return -d.w / 2; }).attr("y", function (d) { return -d.h / 2; })
        .attr("width", function (d) { return d.w; }).attr("height", function (d) { return d.h; })
        .attr("rx", o.size * 0.15)
        .attr("fill", o.box_color || "#ffffff").attr("fill-opacity", o.box_alpha == null ? 1 : o.box_alpha);
    }
    return {
      g: g,
      place: function () {
        var rot = o.angle ? " rotate(" + (-o.angle) + ")" : "";   // o.angle i grader, moturs som i ggplot2
        g.attr("transform", function (d) { return "translate(" + d.x + "," + d.y + ")" + rot; })
          .attr("display", function (d) { return d.hidden ? "none" : null; });
      }
    };
  };

  // Flyttar isär överlappande rutor (d.x/d.y = mitt, d.ax/d.ay = önskad plats) inom bounds.
  // o: sep (px mellanrum), direction ("both" | "x" | "y"), maxOverlaps (döljer resten)
  vgrD3.relaxLabels = function (items, bounds, o) {
    var sep = o.sep == null ? 2 : o.sep, dir = o.direction || "both";
    function pass(pull) {
      var moved = false;
      for (var i = 0; i < items.length; i++) {
        var a = items[i];
        for (var j = i + 1; j < items.length; j++) {
          var b = items[j];
          var ox = (a.w + b.w) / 2 + sep - Math.abs(a.x - b.x);
          var oy = (a.h + b.h) / 2 + sep - Math.abs(a.y - b.y);
          if (ox > 0 && oy > 0) {
            moved = true;
            var alongX = dir === "x" || (dir === "both" && ox < oy);
            if (alongX) {
              var sx = (a.x < b.x || (a.x === b.x && a.ay <= b.ay)) ? -1 : 1;
              a.x += sx * ox / 2; b.x -= sx * ox / 2;
            } else {
              var sy = (a.y < b.y || (a.y === b.y && a.ax <= b.ax)) ? -1 : 1;
              a.y += sy * oy / 2; b.y -= sy * oy / 2;
            }
          }
        }
      }
      // Fasta punkter (t.ex. datapunkterna) som etiketterna inte får täcka — motsvarar ggrepels point.padding
      if (o.points) {
        items.forEach(function (d) {
          o.points.forEach(function (p) {
            var ox = d.w / 2 + p.r - Math.abs(d.x - p.x);
            var oy = d.h / 2 + p.r - Math.abs(d.y - p.y);
            if (ox > 0 && oy > 0) {
              moved = true;
              var alongX = dir === "x" || (dir === "both" && ox < oy);
              if (alongX) d.x += (d.x >= p.x ? 1 : -1) * ox;
              else d.y += (d.y > p.y ? 1 : -1) * oy;
            }
          });
        });
      }
      items.forEach(function (d) {
        if (pull) {
          if (dir !== "y") d.x += (d.ax - d.x) * 0.03;
          if (dir !== "x") d.y += (d.ay - d.y) * 0.03;
        }
        d.x = clamp(d.x, bounds.x0 + d.w / 2, bounds.x1 - d.w / 2);
        d.y = clamp(d.y, bounds.y0 + d.h / 2, bounds.y1 - d.h / 2);
      });
      return moved;
    }
    for (var it = 0; it < 250; it++) if (!pass(true)) break;
    for (var it2 = 0; it2 < 40; it2++) if (!pass(false)) break;
    if (o.maxOverlaps != null) {
      items.forEach(function (a) {
        var n = 0;
        items.forEach(function (b) {
          if (a !== b && Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2) n++;
        });
        a.hidden = n > o.maxOverlaps;
      });
    }
  };

  // Linje från ursprungspunkten (d.ox/d.oy) till närmaste kant på etikettrutan, för flyttade etiketter
  vgrD3.leaderLines = function (parent, items, o) {
    var moved = items.filter(function (d) {
      return !d.hidden && (Math.abs(d.ox - d.x) > d.w / 2 + 1 || Math.abs(d.oy - d.y) > d.h / 2 + 1);
    });
    parent.selectAll(null).data(moved).enter().append("line")
      .attr("x1", function (d) { return d.ox; })
      .attr("y1", function (d) { return d.oy; })
      .attr("x2", function (d) { return clamp(d.ox, d.x - d.w / 2, d.x + d.w / 2); })
      .attr("y2", function (d) { return clamp(d.oy, d.y - d.h / 2, d.y + d.h / 2); })
      .attr("stroke", o.color || "#7f7f7f").attr("stroke-width", o.width || 0.85)
      .attr("pointer-events", "none");
  };

  // ---------------------------------------------------------------------------
  //  Tooltip (HTML, placeras inom widgeten)
  // ---------------------------------------------------------------------------
  vgrD3.tooltip = function (container, font) {
    var tip = d3.select(container).append("div").attr("class", "vgr-d3-tooltip")
      .style("font-family", font).style("opacity", 0);
    function place(x, y) {
      var node = tip.node();
      var tw = node.offsetWidth, th = node.offsetHeight;
      var cw = container.clientWidth, ch = container.clientHeight;
      var px = x + 14, py = y + 14;
      if (px + tw > cw) px = x - tw - 14;
      if (py + th > ch) py = y - th - 14;
      tip.style("left", Math.max(0, px) + "px").style("top", Math.max(0, py) + "px");
    }
    // Pekarens läge i widgetens egna (oskalade) koordinater. Skalas sidan om med CSS, t.ex.
    // av reveal.js, är skärmavståndet större eller mindre än avståndet i widgeten; utan den
    // här omräkningen hamnar tooltipen allt längre från pekaren och kan hamna utanför bilden.
    function local(event) {
      var r = container.getBoundingClientRect();
      var sx = container.offsetWidth ? r.width / container.offsetWidth : 1;
      var sy = container.offsetHeight ? r.height / container.offsetHeight : 1;
      return [(event.clientX - r.left) / (sx || 1), (event.clientY - r.top) / (sy || 1)];
    }
    return {
      show: function (html, event) {
        tip.html(html).style("opacity", 1);
        var p = local(event);
        place(p[0], p[1]);
      },
      showAt: function (html, x, y) { tip.html(html).style("opacity", 1); place(x, y); },
      move: function (event) {
        var p = local(event);
        place(p[0], p[1]);
      },
      hide: function () { tip.style("opacity", 0); },
      visible: function () { return +tip.style("opacity") > 0; },
      // Byter innehåll utan att flytta (t.ex. när år/läge ändras medan tooltipen visas)
      refresh: function (html) { if (+tip.style("opacity") > 0) tip.html(html); }
    };
  };

  vgrD3.tooltipRow = function (label, value, swatch) {
    return "<div class='vgr-tt-row'><span>" +
      (swatch ? "<i class='vgr-tt-swatch' style='background:" + swatch + "'></i>" : "") +
      vgrD3.esc(label) + "</span><b>" + vgrD3.esc(value) + "</b></div>";
  };

  // ---------------------------------------------------------------------------
  //  Kontroller (HTML ovanför SVG:en — kommer inte med i export)
  // ---------------------------------------------------------------------------
  vgrD3.controls = function (container, font) {
    return d3.select(container).append("div").attr("class", "vgr-d3-controls").style("font-family", font);
  };

  vgrD3.button = function (parent, label, onClick, title) {
    return parent.append("button").attr("type", "button").attr("title", title || null).text(label)
      .on("click", function (event) { onClick(event); });
  };

  // Segmenterad knappgrupp: options = [{key, label}], returnerar funktion för att markera aktiv knapp
  vgrD3.buttonGroup = function (parent, options, active, onChange) {
    var g = parent.append("span").attr("class", "vgr-group");
    var buttons = g.selectAll("button").data(options).join("button")
      .attr("type", "button").text(function (d) { return d.label; })
      .on("click", function (event, d) { setActive(d.key); onChange(d.key); });
    function setActive(key) { buttons.classed("vgr-active", function (d) { return d.key === key; }); }
    setActive(active);
    return setActive;
  };

  // ---------------------------------------------------------------------------
  //  Export (PNG/SVG) — serialiserar SVG:en, stilar ligger som attribut i den
  // ---------------------------------------------------------------------------
  vgrD3.serializeSvg = function (svgNode) {
    var clone = svgNode.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    // Skalningen i sidan (width:100%) ska inte följa med — exporten har fast storlek
    clone.style.removeProperty("width");
    clone.style.removeProperty("height");
    clone.style.removeProperty("max-width");
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  };

  vgrD3.download = function (blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 200);
  };

  vgrD3.exportSvg = function (svgNode, filename) {
    vgrD3.download(new Blob([vgrD3.serializeSvg(svgNode)], { type: "image/svg+xml;charset=utf-8" }), filename + ".svg");
  };

  vgrD3.exportPng = function (svgNode, filename, scale) {
    var s = scale || 2;
    var w = +svgNode.getAttribute("width"), h = +svgNode.getAttribute("height");
    var img = new Image();
    img.onload = function () {
      var c = document.createElement("canvas");
      c.width = w * s; c.height = h * s;
      var ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(function (b) { vgrD3.download(b, filename + ".png"); });
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(vgrD3.serializeSvg(svgNode));
  };

  vgrD3.exportButtons = function (parent, svgNode, filename) {
    vgrD3.button(parent, "PNG", function () { vgrD3.exportPng(svgNode, filename, 2); }, "Ladda ner som PNG");
    vgrD3.button(parent, "SVG", function () { vgrD3.exportSvg(svgNode, filename); }, "Ladda ner som SVG");
  };

  vgrD3.slug = function (text) {
    var s = String(text || "diagram").toLowerCase()
      .replace(/[åä]/g, "a").replace(/ö/g, "o").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return s.slice(0, 60) || "diagram";
  };

  // ---------------------------------------------------------------------------
  //  Start
  // ---------------------------------------------------------------------------
  vgrD3.render = function (id) {
    var el = document.getElementById(id);
    if (!el || el.getAttribute("data-rendered")) return;
    // Diagram på en dold del av sidan (t.ex. en reveal.js-bild som inte visas än) ritas när de
    // blir synliga: texter och etiketter går inte att mäta medan de är dolda, och då blir
    // t.ex. legendens bredd fel.
    if (!el.getClientRects().length) {
      if (el.getAttribute("data-waiting")) return;
      el.setAttribute("data-waiting", "1");
      // ResizeObserver svarar direkt när elementet visas; kontrollen med jämna mellanrum är
      // reserv för webbläsare utan ResizeObserver och för flikar som inte ritas
      var ro = null, timer = null;
      var check = function () {
        if (!el.getClientRects().length) return;
        if (ro) ro.disconnect();
        clearInterval(timer);
        el.removeAttribute("data-waiting");
        vgrD3.render(id);
      };
      if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(check); ro.observe(el); }
      timer = setInterval(check, 250);
      return;
    }
    var spec = JSON.parse(document.getElementById(id + "-spec").textContent);
    var fn = vgrD3.renderers[spec.typ];
    if (!fn) { el.textContent = "vgr_D3: okänd diagramtyp '" + spec.typ + "'"; return; }
    el.setAttribute("data-rendered", "1");
    try {
      fn(el, spec);
      el.setAttribute("data-ready", "1");
    } catch (err) {
      el.setAttribute("data-error", String(err));
      d3.select(el).append("pre").style("color", "#b71c1c").text("vgr_D3-fel: " + err + "\n" + (err.stack || ""));
      throw err;
    }
  };

  vgrD3.whenReady = function (f) {
    if (document.readyState !== "loading") f();
    else document.addEventListener("DOMContentLoaded", f);
  };
})();
