# Astris Productions

Two websites live in this one repository.

| | What it is | Where it lives | Who sees it |
|---|---|---|---|
| **The website** | Films, photography, news, Say hello | the top level of this repo | everyone |
| **Astris Studio** | Where you change everything | the `studio/` folder (its own Vercel project) | only you |

The Studio is **not** part of the public website. The public build copies only the public files, so
`yoursite/studio` and `yoursite/admin` simply do not exist for visitors.

---

## The website

- A showreel plays silently on a loop behind every page (a slow slideshow of your photos until you add one).
- The home page is a centred **ASTRIS** over thin **PRODUCTIONS**, then it scrolls over the reel to your
  latest films, photos, a short bio and news.
- **Films**: one gallery for finished films and ones still being made. In-progress films get a banner and a progress bar.
- **Photography**: filter by series, tag, camera, free downloads; a big viewer; free full-size downloads.
- **News**: posts with their own page and a photo gallery.
- **Say hello**: your silhouette, your email (with a copy button) and your links.
- A film reel rolls along the bottom of **every** page.
- A quick opening (the bar drops down the A, then straight in) plays once per visit. Click or press Esc to skip.
- Twelve film-themed page transitions. You choose which ones are used (see the Studio).
- Subtle film grain over everything.

Old links keep working: `#/about`, `#/contact` and `#/downloads` still go to the right place.

## Astris Studio

Open the Studio's own address (you set it up once, see below). It asks for your GitHub key the first time
(the same key the old Studio used). Then:

| Page | What you do there |
|---|---|
| **Overview** | A set-up checklist and quick links |
| **Add photos** | Drop in photos. Camera details are read automatically. ✨ suggests titles and descriptions |
| **Photos** | Edit everything, in bulk or one at a time. ✨ suggests titles for the ones you select |
| **Films** | Add films. Finished or in progress (stage, progress %, latest update), YouTube/Vimeo link, stills, credits |
| **News** | Posts with topics, a summary and a photo gallery |
| **Downloads, Series, Tags** | Same as before |
| **Featured** | Put your featured pictures in order |
| **Showreel & intro** | Upload the showreel, switch the opening on or off, choose the pictures inside the A and on the footer reel, film grain |
| **Transitions** | Try all twelve on a preview screen, switch on the ones you like, choose random / in order / always one / none, and the speed |
| **Home page, Say hello, Site settings** | Every heading, label and line of text |

### Setting the Studio up on Vercel (once)

1. In Vercel, click **Add New → Project** and pick this repository (`penguinator128/Astris`).
2. Set **Root Directory** to `studio`. Leave everything else alone. Click **Deploy**.
3. (Optional, for the ✨ AI buttons) Open the new project's **Settings → Environment Variables** and add
   `ANTHROPIC_API_KEY` with your key from console.anthropic.com. Then **Redeploy**.
   To use a different Claude model, also add `ANTHROPIC_MODEL` (the default is `claude-opus-5-5`).
4. Open the Studio, paste your GitHub key, and in **Site settings** check the "website address" is right.

The AI helper only answers to someone holding your GitHub key, so nobody else can spend your credit.

## Uploading films

- **Full films: use YouTube (or Vimeo) and paste the link** on the film's page in the Studio. The thumbnail is made
  for you, and YouTube does the heavy lifting. GitHub can't hold large video files.
- The **showreel** is the one video that lives on the site itself. About a minute, H.264 mp4, 1920x1080,
  roughly 3 Mbps, no audio, which is around 22 MB. GitHub stops files at 100 MB.
- Short clips (under about 50 MB) can be uploaded straight onto a film as a file.

## Where things live

```
content/photos     one file per photo           content/settings   site.yml, about.yml, contact.yml
content/videos     one file per film            images/uploads     every picture and the showreel
content/news       one file per post            assets/            shared code (logo, intro, transitions)
content/series     one file per series          studio/            the Studio (its own website)
```

The Studio writes these files for you. Every save is a commit, and Vercel rebuilds the site in about a minute.

## If something looks wrong

- **A picture doesn't show.** In the Studio: Site settings → Pictures → turn off "Lighter copies of pictures".
- **A change isn't there yet.** Give it a minute; Vercel is rebuilding. Hard-refresh the page.
- **Visitors are asked to log in to Vercel.** That's Vercel's *Deployment Protection* on your project
  (Project → Settings → Deployment Protection). Turn it off, or add your own domain, when you want the site public.
- **Go back to the old version.** In Vercel, open the project's Deployments and use *Instant Rollback* on an older one.

## For the curious

```
node scripts/check.mjs          # health check: syntax, shared files, content, "the Studio is not published"
node scripts/build-public.mjs   # builds the public site into dist/ (Vercel runs this for you)
node scripts/sync-studio.mjs    # copies the shared files into studio/shared (run after editing assets/*)
```

`vercel.json` (top level) tells Vercel to run the build, publish only `dist/`, and make lighter copies of
pictures. `dist/` also gets `content-snapshot.json`, a copy of your content, so the site loads in one request.
The website then checks GitHub for anything newer.
