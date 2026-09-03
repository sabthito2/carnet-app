/* Service worker du Carnet — garde toujours une copie de secours de
   l'appli, servie instantanément (avant même de demander au réseau), et
   vérifie discrètement en tâche de fond si une version plus récente est
   disponible.

   CACHE_NAME : à changer uniquement si CE fichier lui-même change — pas à
   chaque nouvelle version de l'appli, qui se détecte différemment (en
   comparant le contenu réel de la page, plus bas). */
const CACHE_NAME = "carnet-cache-v1";
const FICHIERS_ESSENTIELS = ["./", "./index.html"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(FICHIERS_ESSENTIELS))
      .catch(() => {}) // une adresse absente ne doit pas empêcher l'installation
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // Seule la page elle-même est concernée : le reste (polices, appels
  // réseau internes…) suit le comportement normal du navigateur.
  if (req.mode !== "navigate" && req.destination !== "document") return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const dansLeCache = await cache.match(req);

      // Vérifie en tâche de fond si le contenu a changé, sans jamais
      // faire attendre l'affichage — et ne prévient que si ça a vraiment
      // changé, pour ne pas déclencher un message à chaque ouverture.
      const verifierMiseAJour = async () => {
        try {
          const reponseReseau = await fetch(req, { cache: "no-store" });
          if (!reponseReseau || !reponseReseau.ok) return;
          const texteReseau = await reponseReseau.clone().text();
          const texteCache = dansLeCache ? await dansLeCache.clone().text() : null;
          if (texteReseau !== texteCache) {
            await cache.put(req, reponseReseau.clone());
            const clients = await self.clients.matchAll();
            clients.forEach((client) => client.postMessage({ type: "nouvelle_version" }));
          }
        } catch (e) {
          // Hors ligne, ou serveur injoignable : on garde le cache tel
          // quel, silencieusement — ce n'est pas une erreur à signaler.
        }
      };

      if (dansLeCache) {
        verifierMiseAJour();
        return dansLeCache;
      }
      // Première visite : rien en cache, on attend le réseau normalement.
      try {
        const reponseReseau = await fetch(req);
        if (reponseReseau && reponseReseau.ok) cache.put(req, reponseReseau.clone());
        return reponseReseau;
      } catch (e) {
        return new Response(
          "Hors ligne, et rien en cache pour l'instant — ouvrez l'appli une première fois avec du réseau.",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
        );
      }
    })
  );
});
