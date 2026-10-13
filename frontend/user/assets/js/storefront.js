/* Shared responsive storefront shell; existing page controllers own all business actions. */
(function () {
  "use strict";
  const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  document.body.classList.add('fb-storefront');
  document.body.dataset.fbPage = page.replace('.html', '');
  const categories = [
    ['fresh', '生鲜果蔬', '🥬'], ['meat', '肉禽海鲜', '🐟'],
    ['snacks', '零食饮品', '🥤'], ['staples', '粮油主食', '🍚'],
    ['seasoning', '调味酱料', '🧂'], ['frozen', '冷冻食品', '🥟'],
    ['household', '日用清洁', '🧴']
  ];
  const isSpecial = ['dailyspecial.html', 'hot.html', 'newcomer.html'].includes(page);
  const current = page === 'category.html' ? 'category' : isSpecial ? 'special' :
    ['cart.html','checkout.html'].includes(page) ? 'cart' :
    /user_center|order|recharge|wallet/.test(page) ? 'account' : 'home';
  const tabs = [
    ['home', 'index.html', '首页', '⌂'], ['category', 'category.html', '分类', '▦'],
    ['special', 'DailySpecial.html', '特价', '%'], ['cart', 'cart.html', '购物车', '🛒'],
    ['account', 'user_center.html', '我的', '○']
  ];
  function navigation(className) {
    const nav = document.createElement('nav');
    nav.className = className;
    nav.setAttribute('aria-label', className === 'fb-bottom-nav' ? '底部主导航' : '网站主导航');
    tabs.forEach(([key, url, label, icon]) => {
      const link = document.createElement('a');
      link.href = '/user/' + url;
      link.dataset.tab = key;
      if (key === current) link.setAttribute('aria-current', 'page');
      if (className === 'fb-bottom-nav') {
        const symbol = document.createElement('span');
        symbol.className = 'fb-nav-icon'; symbol.textContent = icon;
        symbol.setAttribute('aria-hidden','true'); link.append(symbol);
      }
      const text = document.createElement('span'); text.textContent = label; link.append(text);
      if (key === 'cart') {
        const badge = document.createElement('span'); badge.className = 'fb-nav-count';
        badge.hidden = true; link.append(badge);
      }
      nav.append(link);
    });
    return nav;
  }
  // Supply a brand header on standalone order pages, retaining their original content.
  let header = document.querySelector('body > header, body > .top-nav');
  if (!header) {
    header = document.createElement('header');
    header.className = 'fb-simple-header';
    const brand = document.createElement('a'); brand.href = '/user/index.html';
    brand.className = 'fb-brand'; brand.textContent = '在鲜购';
    const subtitle = document.createElement('span'); subtitle.textContent = 'Freshbuy · 新鲜送到家';
    header.append(brand, subtitle); document.body.prepend(header);
  }
  const desktop = navigation('fb-desktop-nav');
  const ordersLink = document.createElement('a'); ordersLink.href = '/user/orders.html';
  ordersLink.textContent = '我的订单';
  if (/order/.test(page)) ordersLink.setAttribute('aria-current', 'page');
  desktop.append(ordersLink); header.append(desktop);
  document.body.append(navigation('fb-bottom-nav'));
  // Legacy list pages fixed their headers but spaced content independently.
  // Measure the final shared header so added desktop navigation never covers products.
  if (getComputedStyle(header).position === 'fixed') {
    document.body.classList.add('fb-fixed-header');
    const measure = () => document.documentElement.style.setProperty('--fb-header-height', Math.ceil(header.getBoundingClientRect().height) + 'px');
    measure();
    if (window.ResizeObserver) new ResizeObserver(measure).observe(header);
    window.addEventListener('resize', measure, {passive:true});
  }
  document.querySelectorAll('.logo-text-main, .title-main').forEach(el => { el.textContent = '在鲜购'; });
  document.querySelectorAll('.logo-text-sub').forEach(el => { el.textContent = 'Freshbuy · 新鲜送到家'; });
  const main = document.querySelector('main.page, main.container, main.detail-page');
  const catalogPage = ['index.html','category.html','dailyspecial.html','hot.html','best.html','new.html','normal.html','newcomer.html'].includes(page);
  if (main && catalogPage) {
    main.classList.add('fb-catalog');
    const sidebar = document.createElement('aside'); sidebar.className = 'fb-category-sidebar';
    const title = document.createElement('h2'); title.textContent = '商品分类'; sidebar.append(title);
    const nav = document.createElement('nav'); nav.setAttribute('aria-label','商品分类');
    const chosen = new URLSearchParams(location.search).get('cat');
    categories.forEach(([key,name,icon]) => {
      const a = document.createElement('a');
      a.href = '/user/category.html?cat=' + key + '&name=' + encodeURIComponent(name);
      a.textContent = icon + '  ' + name;
      if (page === 'category.html' && chosen === key) a.setAttribute('aria-current','page');
      nav.append(a);
    });
    sidebar.append(nav);
    const content = document.createElement('div'); content.className = 'fb-catalog-content';
    while (main.firstChild) content.append(main.firstChild);
    main.append(sidebar, content);
  }
  if (page === 'index.html') {
    const host = document.querySelector('.page-main');
    if (host) {
      const welcome = document.createElement('section'); welcome.className = 'fb-welcome';
      welcome.innerHTML = '<div><span class="fb-eyebrow">FRESHBUY · ONLINE GROCERY</span><h1>日常好食材，新鲜送到家</h1><p>精选亚洲食品与家庭日用品，在线选购，轻松到家。</p></div><a href="/user/Normal.html">选购全部商品 <span aria-hidden="true">→</span></a>';
      host.prepend(welcome);
      const shortcuts = document.querySelector('.side-rail');
      const delivery = host.querySelector('.delivery-mode');
      if (shortcuts && delivery) delivery.after(shortcuts);
    }
  }
  // Search remains handled by the existing controllers. Details lack a controller for this field.
  if (page === 'index.html') {
    const sections = [...document.querySelectorAll('.home-section')];
    const stickyTitle = document.createElement('div');
    stickyTitle.className = 'fb-current-section';
    stickyTitle.hidden = true;
    // A visual copy only: the original section headings remain available to screen readers.
    stickyTitle.setAttribute('aria-hidden', 'true');
    document.body.append(stickyTitle);
    let scheduled = false;
    function updateSectionTitle() {
      scheduled = false;
      const top = Math.max(0, Math.ceil(header.getBoundingClientRect().bottom));
      const active = sections.find(section => {
        const rect = section.getBoundingClientRect();
        const title = section.querySelector('.section-header');
        return title && rect.width > 0 && title.getBoundingClientRect().top <= top && rect.bottom > top;
      });
      if (!active) { stickyTitle.hidden = true; return; }
      const rect = active.getBoundingClientRect();
      const title = active.querySelector('.section-title');
      stickyTitle.textContent = title?.textContent || '';
      stickyTitle.style.left = Math.max(0,rect.left) + 'px';
      stickyTitle.style.width = Math.min(rect.width, innerWidth - Math.max(0,rect.left)) + 'px';
      stickyTitle.style.top = top + 'px';
      stickyTitle.hidden = false;
      // Let the next section push the current title away at the section boundary.
      const height = stickyTitle.getBoundingClientRect().height;
      stickyTitle.style.transform = 'translateY(' + Math.min(0, rect.bottom - top - height) + 'px)';
    }
    function scheduleSectionTitle() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(updateSectionTitle);
    }
    window.addEventListener('scroll', scheduleSectionTitle, {passive:true});
    document.addEventListener('scroll', scheduleSectionTitle, {passive:true,capture:true});
    window.addEventListener('resize', scheduleSectionTitle, {passive:true});
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(scheduleSectionTitle);
      observer.observe(header);
      sections.forEach(section => observer.observe(section));
    }
    scheduleSectionTitle();
  }
  document.querySelectorAll('input.search-input, #globalSearchInput, input.search-small').forEach(input => {
    input.type = 'search'; input.setAttribute('aria-label', input.placeholder || '搜索商品');
    input.setAttribute('enterkeyhint','search');
    if (page === 'product_detail.html') input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && input.value.trim()) location.href = '/user/index.html?q=' + encodeURIComponent(input.value.trim());
    });
  });
  if (page === 'index.html') {
    const auth = new URLSearchParams(location.search).get('auth');
    if (auth) document.addEventListener('DOMContentLoaded', () => {
      document.getElementById(auth === 'register' ? 'registerBtn' : 'loginBtn')?.click();
    }, {once:true});
    const query = new URLSearchParams(location.search).get('q');
    if (query) {
      const input = document.getElementById('globalSearchInput');
      if (input) input.value = query;
      // Product fetch is asynchronous: wait for cards, then use the original search controller.
      const observer = new MutationObserver(() => {
        if (!document.querySelector('.product-card') || typeof window.doSearch !== 'function') return;
        observer.disconnect(); window.doSearch(query);
      });
      if (main) observer.observe(main, {childList:true,subtree:true});
    }
  }
  document.querySelectorAll('.cart-icon').forEach(icon => {
    icon.setAttribute('role','button'); icon.tabIndex = 0; icon.setAttribute('aria-label','打开购物车');
    icon.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); icon.click(); } });
  });
  if (page === 'product_detail.html') {
    document.querySelectorAll('.user-area .link-btn').forEach(btn => {
      btn.addEventListener('click', () => { location.href = '/user/index.html?auth=' + (btn.textContent.includes('注册') ? 'register' : 'login'); });
    });
  }
  document.addEventListener('error', event => {
    const img = event.target;
    if (img.tagName !== 'IMG' || !img.closest('.product-card, .cart-item, .detail-recommend-card')) return;
    const placeholder = '/user/assets/icons/product-placeholder.svg';
    if (!img.src.endsWith(placeholder)) img.src = placeholder;
  }, true);
  function syncCount() {
    const cart = window.FreshCart || window.Cart;
    let state;
    try { state = cart?.getCart?.() || cart?.getState?.(); } catch (_) { return; }
    const count = (state?.items || []).reduce((sum,item) => sum + Number(item.qty || item.quantity || 0),0);
    document.querySelectorAll('.fb-nav-count').forEach(badge => {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.hidden = count === 0; badge.setAttribute('aria-label', count + ' 件商品');
    });
  }
  window.addEventListener('freshbuy:cartUpdated',syncCount);
  window.addEventListener('storage',syncCount);
  syncCount();
})();
