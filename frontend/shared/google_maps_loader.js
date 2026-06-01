(function () {
  let loadingPromise = null;

  async function getClientConfig() {
    const res = await fetch("/api/public/client-config", { cache: "no-store" });
    if (!res.ok) throw new Error("client config unavailable");
    return res.json();
  }

  window.loadFreshbuyGoogleMaps = async function loadFreshbuyGoogleMaps(options = {}) {
    const callbackName = options.callbackName || "";
    const libraries = options.libraries || "";

    if (window.google && window.google.maps) {
      if (callbackName && typeof window[callbackName] === "function") window[callbackName]();
      return;
    }

    if (!loadingPromise) {
      loadingPromise = (async () => {
        const data = await getClientConfig();
        const key = data && data.googleMapsBrowserKey;

        if (!key) {
          console.warn("Google Maps browser key is not configured.");
          window.dispatchEvent(new CustomEvent("freshbuy:maps-unavailable"));
          return;
        }

        await new Promise((resolve, reject) => {
          const callback = "__freshbuyGoogleMapsReady";
          window[callback] = () => {
            resolve();
            setTimeout(() => {
              try { delete window[callback]; } catch {}
            }, 0);
          };

          const script = document.createElement("script");
          const params = new URLSearchParams({ key, callback, loading: "async" });
          if (libraries) params.set("libraries", libraries);
          script.src = "https://maps.googleapis.com/maps/api/js?" + params.toString();
          script.async = true;
          script.defer = true;
          script.onerror = () => reject(new Error("Google Maps failed to load"));
          document.head.appendChild(script);
        });
      })();
    }

    await loadingPromise;

    if (callbackName && typeof window[callbackName] === "function") {
      window[callbackName]();
    }
  };
})();