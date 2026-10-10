"""CLOCKIN_ONLY: truthful Devnet pitch, no wallet/network/secret access."""
from pathlib import Path
from hashlib import sha256
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph

ROOT = Path(__file__).resolve().parents[1]
APK = ROOT / "apps/c3-pilot/dist/devnet-evaluation-lifecycle-v5/c-market-c3-devnet-evaluation-0.1.4.apk"
APK_HASH = "1fda6bfde22e74eb9e661aa8e0932fc69b139ddc83873b44033075004c46f743"
if sha256(APK.read_bytes()).hexdigest() != APK_HASH:
    raise RuntimeError("APK_HASH_MISMATCH")
OUT = ROOT / "output/pdf/C-Market-C3-Devnet-Pitch.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)
c = canvas.Canvas(str(OUT), pagesize=(960, 540), invariant=1)
c.setTitle("C Market C3 - Devnet evaluation; physical acceptance pending")
c.setAuthor("C Market")
BG, LIGHT, GREEN, MUTED = map(HexColor, ["#071B16", "#EFF9F4", "#79DEAC", "#AAC9BD"])
body = ParagraphStyle("body", fontName="Helvetica", fontSize=19, leading=28, textColor=LIGHT)
small = ParagraphStyle("small", fontName="Helvetica", fontSize=12, leading=19, textColor=MUTED)

def paragraph(value, y, style=body):
    p = Paragraph(value, style)
    _, height = p.wrap(860, 400)
    if y - height < 65:
        raise RuntimeError("PAGE_OVERFLOW")
    p.drawOn(c, 50, y - height)

slides = [
    ("One basket. Verifiable ownership.",
     "C3 strategic target: 40% Bitcoin / 30% Ethereum / 30% Solana.",
     "This Android evaluation uses clearly labelled test assets and a test router on Solana Devnet. No real BTC/ETH, Jupiter Devnet liquidity, investment value or guaranteed return.",
     "Mainnet is disabled. C5 and other products are coming soon."),
    ("An on-chain lifecycle, not a payment receipt",
     "Wallet approval is explicit; underlying test assets stay in program-owned custody.",
     "Connect via MWA and prove wallet ownership.<br/>Deposit exactly 1 test USDC; process three bounded 40/30/30 test buys.<br/>Issue actual on-chain share tokens and query the position.<br/>Sell the acquired test inventory, burn shares and claim realized test USDC.",
     "A historical treasury payment is not acquisition of C3 shares. This flow is sequential, not atomic."),
    ("Hosted technical acceptance: PASS",
     "10 October 2026 - same HTTPS services and PostgreSQL journals as the APK.",
     "Six test-router swaps and all owner actions finalized on Devnet.<br/>1,000,000 share base units issued, then burned.<br/>0.99 test USDC actually returned; zero remaining vault inventory.<br/>Duplicate claim rejected; original signatures survive restart and renewal.",
     "This run used an evaluation test key, NOT physical Phantom approval. Explorer evidence is in the public QA document."),
    ("Recovery without blind retries",
     "Missing or contradictory evidence cannot advance the economic state.",
     "Persist the exact message and signature before one submission attempt.<br/>Reconcile uncertain results using the original signature.<br/>Renew expired plans only after explicit owner review and finalized expiry barriers.<br/>Retain generations, minimum outputs, acquired inventory and history.",
     "Hosted PostgreSQL and HTTPS processing do not require a local validator or Mac backend. Independent-network physical acceptance is still pending."),
    ("Seeker candidate and honest delivery gate",
     "C Market Devnet 0.1.4 / code 5 - compatible signed package, no Metro.",
     "Home / Indices / Activity. English, Spanish, Simplified Chinese and Brazilian Portuguese.<br/>Cold launch and Phantom connection/return observed.<br/>Physical message signing, full wallet-approved lifecycle, restart and off-Mac acceptance remain pending.<br/>No completed physical recording or final submission is claimed.",
     "Existing stable app and Mainnet candidate are preserved. Scope tests and internal reviews are not a professional audit."),
    ("Evaluate the exact artifact",
     "Download, compare the digest, then follow the supervised Devnet instructions.",
     "Website: https://cmarket-nine.vercel.app/<br/>Source: github.com/dominaweb3-art/cmarket-clock-in<br/>Branch: delivery/c3-devnet-evaluation<br/>Only free Devnet SOL and worthless test tokens. One lifetime position per wallet-specific vault.",
     "APK SHA-256: " + APK_HASH),
]
for n, (title, subtitle, content, note) in enumerate(slides, 1):
    c.setFillColor(BG)
    c.rect(0, 0, 960, 540, fill=1, stroke=0)
    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(50, 501, "C MARKET / C3 / CLOCK IN")
    c.drawImage(str(ROOT / "assets/brand/cmarket-wordmark.png"), 738, 482,
                width=172, height=43, preserveAspectRatio=True, mask="auto")
    c.setFillColor(LIGHT)
    c.setFont("Helvetica-Bold", 29)
    c.drawString(50, 444, title)
    paragraph(subtitle, 419, small)
    paragraph(content, 360)
    paragraph(note, 135, small)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 10)
    c.drawString(50, 28, "10 October 2026 | Physical acceptance pending | No real funds")
    c.drawRightString(910, 28, f"{n} / {len(slides)}")
    c.showPage()
c.save()
print(str(OUT))
