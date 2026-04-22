# TRYNYTY Branding Update — Drop-In Files

## What's in this zip

**10 replacement files** — drop these into your repo folder, overwriting the existing versions:

- `styles.css` — adds the new styles (hero watermark, section dividers, bigger footer brand, bigger trinity center, blog author brand mark)
- `index.html` — favicon tags + hero watermark + 2 section dividers
- `about.html` — favicon tags
- `asresume.html` — favicon tags
- `blog.html` — favicon tags + section divider before footer
- `contact.html` — favicon tags
- `thanks.html` — favicon tags
- `tools.html` — favicon tags
- `post-lead-model.html` — favicon tags + author brand mark
- `post-reach-analysis.html` — favicon tags + author brand mark

**1 small PowerShell helper** — `add-favicons-to-blog-posts.ps1`

## Deploy steps

### Step 1 — Drop in the 10 files
Unzip this folder and copy all 10 HTML/CSS files into your local repo folder, overwriting the existing files. (Leave the PowerShell script `.ps1` file aside for now — don't commit it.)

### Step 2 — Run the PowerShell helper
The 5 other blog posts in your repo (post-2027-call-letter, post-cms-risk-adjustment, post-mssp-lead-analysis, post-v24-v28, post-vbc-barriers) also need the 3 favicon lines added. Rather than edit them by hand, run the included script:

1. Move `add-favicons-to-blog-posts.ps1` into your repo folder (same place as index.html)
2. Right-click it → "Run with PowerShell"  
   *(Or open PowerShell in that folder and type: `.\add-favicons-to-blog-posts.ps1`)*
3. You'll see it print `OK  post-2027-call-letter.html` etc. for each file it updated

The script is safe — it only adds 3 lines to each file, it checks whether the file already has them (so re-running is fine), and it prints exactly what it did.

Once it finishes, you can delete the `.ps1` file (or leave it — your `.gitignore` or a git add dot won't commit it if you prefer to keep it locally).

### Step 3 — Deploy
Your usual PowerShell sequence:

```powershell
git add .
git commit -m "Add logo branding — favicon, hero watermark, section dividers, larger footer"
git push
git push origin master:main --force
```

## What you'll see live

- **Browser tabs / bookmarks / link previews**: TRYNYTY logo instead of a globe icon
- **Homepage hero**: a large, very faded logo watermark in the background (desktop only; hidden on mobile)
- **Homepage dividers**: a small teal logo between Problem/Services, and between Feature/Trinity sections
- **Blog page**: a small teal logo between the newsletter signup and the footer
- **Trinity diagram**: the center logo is bigger with a soft teal glow
- **Footer**: logo 60×60, TRYNYTY 22px, tagline 15px (one step up from last time)
- **Blog posts (lead-model, reach-analysis)**: small logo mark in the author bio next to "TRYNYTY health:enablement"

## If anything looks off

All the key sizes are easy to tweak in `styles.css`. Search for these selectors:

- `.hero-logo-watermark` — watermark on homepage hero (width/height: 520px, opacity: 0.06)
- `.section-divider img` — the teal logo between sections (width/height: 28px, opacity: 0.55)
- `.trinity-center` — the bigger Trinity center (width/height: 78px, inner img: 58px)
- `.footer-brand .logo-mark-img` — footer logo (width/height: 60px)

Dial the number up or down and re-deploy. That's it.
