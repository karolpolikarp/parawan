"""Generator 50 fikcyjnych pism do testowania anonimizatora (z kluczem ground truth)."""
import random, json, re, os, csv, datetime as dt, sys
from docx import Document
from docx.shared import Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH as AL

OUT = sys.argv[1] if len(sys.argv) > 1 else "anonimizator-testy"
MONTHS = ["stycznia","lutego","marca","kwietnia","maja","czerwca","lipca","sierpnia","września","października","listopada","grudnia"]
CASES = ["nom","gen","dat","acc","ins"]

# ---------- identyfikatory z sumami kontrolnymi ----------
def pesel_of(d, female, rng):
    mm = d.month + (20 if d.year >= 2000 else 0)
    sex = rng.choice([0,2,4,6,8]) if female else rng.choice([1,3,5,7,9])
    base = f"{d.year%100:02d}{mm:02d}{d.day:02d}{rng.randint(0,999):03d}{sex}"
    w = [1,3,7,9,1,3,7,9,1,3]
    return base + str((10 - sum(int(a)*b for a,b in zip(base,w)) % 10) % 10)
def pesel_ok(p):
    w = [1,3,7,9,1,3,7,9,1,3]
    return len(p)==11 and p.isdigit() and (10 - sum(int(a)*b for a,b in zip(p[:10],w)) % 10) % 10 == int(p[10])
def fake_pesel(rng):
    while True:
        s = "".join(str(rng.randint(0,9)) for _ in range(11))
        if not pesel_ok(s): return s
def nip_gen(rng):
    w = [6,5,7,2,3,4,5,6,7]
    while True:
        p = str(rng.randint(1,9)) + "".join(str(rng.randint(0,9)) for _ in range(8))
        c = sum(int(a)*b for a,b in zip(p,w)) % 11
        if c != 10: return p + str(c)
def regon_gen(rng):
    w = [8,9,2,3,4,5,6,7]
    p = "".join(str(rng.randint(0,9)) for _ in range(8))
    c = sum(int(a)*b for a,b in zip(p,w)) % 11
    return p + str(0 if c == 10 else c)
def chv(ch): return int(ch) if ch.isdigit() else ord(ch) - 55
def dowod_gen(rng):
    L = "".join(rng.choice("ABCDEFGHJKLMNPRSTWXYZ") for _ in range(3)); D = "".join(str(rng.randint(0,9)) for _ in range(5))
    c = sum(chv(a)*b for a,b in zip(L+D,[7,3,1,7,3,1,7,3])) % 10
    return f"{L}{c}{D}"
def paszport_gen(rng):
    L = "".join(rng.choice("ABCDEFGHJKLMNPRSTWXYZ") for _ in range(2)); D = "".join(str(rng.randint(0,9)) for _ in range(6))
    c = sum(chv(a)*b for a,b in zip(L+D,[7,3,1,7,3,1,7,3])) % 10
    return f"{L}{c}{D}"
BANKS = ["10901014","11402004","24900005","10500099","12401037","10202892","11602202","19401076"]
def iban_gen(rng):
    bban = rng.choice(BANKS) + "".join(str(rng.randint(0,9)) for _ in range(16))
    k = 98 - int(bban + "252100") % 97
    return f"{k:02d}{bban}"   # 26 cyfr NRB
def iban_fmt(nrb, rng, style=None):
    style = style if style is not None else rng.randint(0,3)
    g = lambda s: " ".join([s[:2]] + [s[i:i+4] for i in range(2,26,4)])
    return ["PL" + g(nrb), g(nrb), "PL" + nrb, nrb][style]
def krs_gen(rng): return f"{rng.randint(100000, 999999):010d}"
KW_V = {**{str(i): i for i in range(10)}, "X":10,"A":11,"B":12,"C":13,"D":14,"E":15,"F":16,"G":17,"H":18,"I":19,"J":20,"K":21,"L":22,"M":23,"N":24,"O":25,"P":26,"R":27,"S":28,"T":29,"U":30,"W":31,"Y":32,"Z":33}
def kw_gen(rng, court):
    num = f"{rng.randint(1,99999999):08d}"; s = court + num
    c = sum(KW_V[ch]*[1,3,7][i%3] for i,ch in enumerate(s)) % 10
    return f"{court}/{num}/{c}"
def pwz_gen(rng):
    while True:
        d = [rng.randint(0,9) for _ in range(6)]; c = sum(x*(i+1) for i,x in enumerate(d)) % 11
        if c != 0 and c != 10: return str(c) + "".join(map(str,d))
def vin_gen(rng): return "".join(rng.choice("ABCDEFGHJKLMNPRSTUVWXYZ0123456789") for _ in range(17))
def plate_gen(rng):
    pre = rng.choice(["WX","WI","WE","KR","GD","EL","WPI","WPR","PO","DW"])
    tail = rng.choice([f"{rng.randint(10000,99999)}", f"{rng.randint(1000,9999)}{rng.choice('ACEFHKLMNPRSTWXY')}", f"{rng.randint(100,999)}{rng.choice('ACEHKLMNPRSTWXY')}{rng.choice('ACEHKLMNPRSTWXY')}"])
    return f"{pre} {tail}"
def prawojazdy_gen(rng): return f"{rng.randint(1,99999):05d}/{rng.randint(5,24):02d}/{rng.randint(1000,3299)}"
def ip_gen(rng):
    return rng.choice([f"192.0.2.{rng.randint(2,254)}", f"198.51.100.{rng.randint(2,254)}", f"203.0.113.{rng.randint(2,254)}", f"2001:db8:{rng.randint(1,0xfff):x}::{rng.randint(1,0xfff):x}"])

# ---------- osoby ----------
FEM = {"Anna":("Anny","Annie","Annę","Anną"),"Katarzyna":("Katarzyny","Katarzynie","Katarzynę","Katarzyną"),
 "Małgorzata":("Małgorzaty","Małgorzacie","Małgorzatę","Małgorzatą"),"Agnieszka":("Agnieszki","Agnieszce","Agnieszkę","Agnieszką"),
 "Ewa":("Ewy","Ewie","Ewę","Ewą"),"Joanna":("Joanny","Joannie","Joannę","Joanną"),"Magdalena":("Magdaleny","Magdalenie","Magdalenę","Magdaleną"),
 "Monika":("Moniki","Monice","Monikę","Moniką"),"Barbara":("Barbary","Barbarze","Barbarę","Barbarą"),"Zofia":("Zofii","Zofii","Zofię","Zofią"),
 "Marta":("Marty","Marcie","Martę","Martą"),"Jadwiga":("Jadwigi","Jadwidze","Jadwigę","Jadwigą"),"Aleksandra":("Aleksandry","Aleksandrze","Aleksandrę","Aleksandrą"),
 "Weronika":("Weroniki","Weronice","Weronikę","Weroniką")}
FEM_FOREIGN = {"Olena":("Oleny","Olenie","Olenę","Oleną"),"Iryna":("Iryny","Irynie","Irynę","Iryną"),"Tetiana":("Tetiany","Tetianie","Tetianę","Tetianą")}
MASC = {"Piotr":("Piotra","Piotrowi","Piotra","Piotrem"),"Tomasz":("Tomasza","Tomaszowi","Tomasza","Tomaszem"),
 "Krzysztof":("Krzysztofa","Krzysztofowi","Krzysztofa","Krzysztofem"),"Paweł":("Pawła","Pawłowi","Pawła","Pawłem"),
 "Michał":("Michała","Michałowi","Michała","Michałem"),"Marek":("Marka","Markowi","Marka","Markiem"),"Jakub":("Jakuba","Jakubowi","Jakuba","Jakubem"),
 "Andrzej":("Andrzeja","Andrzejowi","Andrzeja","Andrzejem"),"Łukasz":("Łukasza","Łukaszowi","Łukasza","Łukaszem"),"Adam":("Adama","Adamowi","Adama","Adamem"),
 "Grzegorz":("Grzegorza","Grzegorzowi","Grzegorza","Grzegorzem"),"Antoni":("Antoniego","Antoniemu","Antoniego","Antonim"),
 "Mariusz":("Mariusza","Mariuszowi","Mariusza","Mariuszem"),"Wojciech":("Wojciecha","Wojciechowi","Wojciecha","Wojciechem")}
ADJ = ["Nowakowsk","Lewandowsk","Wiśniewsk","Zielińsk","Kamińsk","Jabłońsk","Wysock","Zawadzk","Dąbrowsk","Sadowsk","Michalsk","Pietrzyck"]
NOUN = {"Kowal":("Kowala","Kowalowi","Kowala","Kowalem"),"Kos":("Kosa","Kosowi","Kosa","Kosem"),"Lis":("Lisa","Lisowi","Lisa","Lisem"),
 "Wróbel":("Wróbla","Wróblowi","Wróbla","Wróblem"),"Nowak":("Nowaka","Nowakowi","Nowaka","Nowakiem"),"Kaczmarek":("Kaczmarka","Kaczmarkowi","Kaczmarka","Kaczmarkiem"),
 "Wrzosek":("Wrzoska","Wrzoskowi","Wrzoska","Wrzoskiem"),"Mazur":("Mazura","Mazurowi","Mazura","Mazurem"),"Wójcik":("Wójcika","Wójcikowi","Wójcika","Wójcikiem"),
 "Kot":("Kota","Kotowi","Kota","Kotem"),"Polak":("Polaka","Polakowi","Polaka","Polakiem"),"Krawczyk":("Krawczyka","Krawczykowi","Krawczyka","Krawczykiem"),
 "Zima":("Zimy","Zimie","Zimę","Zimą"),"Sikora":("Sikory","Sikorze","Sikorę","Sikorą"),"Sowa":("Sowy","Sowie","Sowę","Sową"),"Kawa":("Kawy","Kawie","Kawę","Kawą")}
DOUBLE_FEM = {"Lipowska-Dąbek":("Lipowskiej-Dąbek","Lipowskiej-Dąbek","Lipowską-Dąbek","Lipowską-Dąbek"),
              "Nowicka-Grabowska":("Nowickiej-Grabowskiej","Nowickiej-Grabowskiej","Nowicką-Grabowską","Nowicką-Grabowską")}
FOREIGN_LAST = ["Kovalenko","Shevchenko","Bondarenko"]

class P:
    def __init__(s, female, first, last):
        s.female = female; s.f = first; s.l = last
    def n(s, c="nom"): return f"{s.f[c]} {s.l[c]}"
    def ini(s): return f"{s.f['nom'][0]}. {s.l['nom']}"
    def g(s, fem, masc): return fem if s.female else masc

def last_forms(key, female):
    kind, v = key
    if kind == "adj":
        e = ("a","iej","iej","ą","ą") if female else ("i","iego","iemu","iego","im")
        return dict(zip(CASES, [v + x for x in e]))
    if kind == "noun":
        if female and not v.endswith("a"): return dict.fromkeys(CASES, v)
        return dict(zip(CASES, (v,) + NOUN[v]))
    if kind == "double": return dict(zip(CASES, (v,) + DOUBLE_FEM[v]))
    if kind == "foreign": return dict.fromkeys(CASES, v)

def asc(s):
    return s.lower().translate(str.maketrans("ąćęłńóśźż","acelnoszz")).replace(" ","")

# ---------- adresy, instytucje ----------
STREETS = ["ul. Marii Konopnickiej","ul. Jana Heweliusza","ul. Adama Mickiewicza","ul. Kazimierza Wielkiego","al. Jana Pawła II","ul. Polna",
           "ul. Kwiatowa","ul. Leśna","ul. Słoneczna","ul. Ogrodowa","ul. Lipowa","ul. Krótka","ul. Brzozowa","ul. Stefana Żeromskiego","ul. Księcia Józefa Poniatowskiego"]
CITIES = [("Warszawa","02-5"),("Warszawa","03-2"),("Kraków","30-3"),("Gdańsk","80-2"),("Łódź","91-4"),("Piaseczno","05-50"),
          ("Wrocław","50-3"),("Poznań","61-6"),("Lublin","20-8"),("Pruszków","05-80"),("Józefosław","05-50"),("Konstancin-Jeziorna","05-52")]
URZEDY = [("Urząd m.st. Warszawy\nDzielnica Mokotów\nWydział Obsługi Mieszkańców","ul. Rakowiecka 25/27","02-517","Warszawa","Urząd m.st. Warszawy"),
          ("Urząd Miasta Krakowa\nWydział Podatków i Opłat","al. Powstania Warszawskiego 10","31-549","Kraków","Urząd Miasta Krakowa"),
          ("Urząd Miejski w Gdańsku\nWydział Gospodarki Komunalnej","ul. Nowe Ogrody 8/12","80-803","Gdańsk","Urząd Miejski w Gdańsku"),
          ("Urząd Miasta Łodzi\nWydział Finansowy","ul. Piotrkowska 104","90-926","Łódź","Urząd Miasta Łodzi")]
SADY_O = ["Sąd Okręgowy w Warszawie","Sąd Okręgowy w Krakowie","Sąd Okręgowy w Gdańsku","Sąd Okręgowy w Łodzi"]
SADY_R = ["Sąd Rejonowy dla Warszawy-Mokotowa w Warszawie","Sąd Rejonowy dla Krakowa-Podgórza w Krakowie","Sąd Rejonowy Gdańsk-Południe w Gdańsku","Sąd Rejonowy dla Łodzi-Śródmieścia w Łodzi"]
FIRMY = ["Lipowy Dwór sp. z o.o.","Bałtycka Energia Odnawialna sp. z o.o.","Kamex Logistyka sp. z o.o.","Mebloteka Online sp. z o.o.","Domowe AGD Direct S.A.",
         "TU Przezorny S.A.","Drewnostal sp. z o.o.","Zielony Kwadrat sp. k."]
DOMAINS = ["poczta-test.pl","skrzynka-test.pl","mail-test.pl","example.com"]

class Doc:
    def __init__(s, idx, tpl, title, seed):
        s.idx, s.tpl, s.title = idx, tpl, title
        s.rng = random.Random(seed); s.blocks = []; s.ents = []; s.traps = []
        s.used_first = set(); s.used_last = set(); s.inst_postals = set()
        s.date = dt.date(2026, s.rng.randint(1,10), s.rng.randint(1,28))
    # rejestracja encji
    def e(s, text, typ, note="", expect="mask"):
        s.ents.append({"text": text, "type": typ, "expect": expect, "note": note}); return text
    def keep(s, text, typ, note=""): return s.e(text, typ, note, expect="keep")
    def pol(s, text, typ, note=""): return s.e(text, typ, note, expect="policy")
    def b(s, kind, text): s.blocks.append((kind, text))
    def trap(s, t): s.traps.append(t)
    # osoby
    def person(s, female=None, lastkey=None, foreign=False, surname_from=None, double=False):
        r = s.rng
        female = r.random() < 0.5 if female is None else female
        if foreign:
            female = True; pool = FEM_FOREIGN
        else:
            pool = FEM if female else MASC
        fn = r.choice([k for k in pool if k not in s.used_first]); s.used_first.add(fn)
        first = dict(zip(CASES, (fn,) + pool[fn]))
        if lastkey is None:
            if foreign: lastkey = ("foreign", r.choice(FOREIGN_LAST))
            elif double and female: lastkey = ("double", r.choice(list(DOUBLE_FEM)))
            elif surname_from: lastkey = ("noun", r.choice([x for x in surname_from if x not in s.used_last] or surname_from))
            else:
                while True:
                    lastkey = ("adj", r.choice(ADJ)) if r.random() < 0.45 else ("noun", r.choice(list(NOUN)))
                    if lastkey[1] not in s.used_last: break
        s.used_last.add(lastkey[1])
        p = P(female, first, last_forms(lastkey, female)); p.lastkey = lastkey
        return p
    def n(s, p, c="nom"): return s.e(p.n(c), "PERSON")
    def sn(s, p, c="nom"): return s.e(p.l[c], "PERSON", note="samo nazwisko")
    def ini(s, p): return s.e(p.ini(), "PERSON", note="inicjał imienia + nazwisko")
    def first_only(s, p, c="nom"): return s.e(p.f[c], "PERSON_FIRSTNAME", note="samo imię")
    def birth(s, p, lo=1950, hi=2004):
        p.birth = dt.date(s.rng.randint(lo,hi), s.rng.randint(1,12), s.rng.randint(1,28))
        p.pesel = pesel_of(p.birth, p.female, s.rng); return p
    def pesel(s, p): return s.e(p.pesel, "PESEL")
    def dob(s, p, style=None):
        d = p.birth; style = s.rng.randint(0,2) if style is None else style
        t = [d.strftime("%d.%m.%Y"), f"{d.day} {MONTHS[d.month-1]} {d.year}", d.isoformat()][style]
        return s.e(t, "DATE_BIRTH")
    def addr(s, city=None, plain=False):
        r = s.rng
        c, pre = city or r.choice(CITIES)
        post = pre + "".join(str(r.randint(0,9)) for _ in range(5-len(pre.replace("-",""))))
        while post in s.inst_postals: post = post[:-1] + str(r.randint(0,9))
        st = r.choice(STREETS); num = r.randint(1,120)
        st_full = f"{st} {num}" if plain else r.choice([f"{st} {num}", f"{st} {num} m. {r.randint(1,60)}", f"{st} {num}/{r.randint(1,60)}", f"{st} {num}{r.choice('ABC')} lok. {r.randint(1,20)}"])
        return s.e(st_full, "ADDRESS"), s.e(post, "POSTAL"), s.pol(c, "CITY", "miejscowość z adresu osoby")
    def inst(s, name, street, post, city, *keep_names):
        s.inst_postals.add(post)
        for k in keep_names: s.keep(k, "INSTITUTION")
        s.keep(street, "INSTITUTION_ADDRESS"); s.keep(post, "INSTITUTION_POSTAL")
        return f"{name}\n{street}\n{post} {city}"
    def phone(s, mobile=True, style=None):
        r = s.rng
        if mobile:
            d = str(r.choice([5,6,7,8])) + "".join(str(r.randint(0,9)) for _ in range(8))
            st = [f"{d[:3]} {d[3:6]} {d[6:]}", f"+48 {d[:3]} {d[3:6]} {d[6:]}", f"{d[:3]}-{d[3:6]}-{d[6:]}", d, f"+48{d}"]
        else:
            d = r.choice(["22","12","58","42","61","71"]) + "".join(str(r.randint(0,9)) for _ in range(7))
            st = [f"{d[:2]} {d[2:5]} {d[5:7]} {d[7:]}", f"({d[:2]}) {d[2:5]} {d[5:7]} {d[7:]}", f"{d[:2]} {d[2:]}"]
        i = r.randrange(len(st)) if style is None else style
        return d, s.e(st[i], "PHONE")
    def phone_again(s, digits, mobile=True):
        st = [f"+48 {digits[:3]} {digits[3:6]} {digits[6:]}", f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"] if mobile else [f"({digits[:2]}) {digits[2:5]} {digits[5:7]} {digits[7:]}"]
        return s.e(s.rng.choice(st), "PHONE", note="ten sam numer w innym formacie")
    def email(s, p, domain=None):
        r = s.rng; f, l = asc(p.f["nom"]), asc(p.l["nom"])
        loc = r.choice([f"{f[0]}.{l}", f"{f}.{l}", f"{l}{f[0]}{r.randint(10,99)}", f"{f}{r.randint(70,99)}"])
        return s.e(f"{loc}@{domain or r.choice(DOMAINS)}", "EMAIL")
    def iban(s, style=None, owner="person"):
        t = iban_fmt(iban_gen(s.rng), s.rng, style)
        return s.e(t, "IBAN") if owner == "person" else s.pol(t, "IBAN_COMPANY", "rachunek osoby prawnej")
    def ddate(s, d=None): d = d or s.date; return f"{d.day} {MONTHS[d.month-1]} {d.year} r."
    def company(s, full=True):
        name = s.rng.choice(FIRMY)
        if not full: return {"name": s.pol(name, "COMPANY")}
        return {"name": s.pol(name, "COMPANY"), "krs": s.pol(krs_gen(s.rng), "KRS"),
                "nip": s.pol(nip_gen(s.rng), "NIP_COMPANY"), "regon": s.pol(regon_gen(s.rng), "REGON_COMPANY")}

    # zapis
    def text(s): return "\n".join(t for _, t in s.blocks)
    def finish(s):
        txt = s.text(); out = {}
        for en in s.ents:
            k = (en["text"], en["expect"])
            if k in out: continue
            pat = r"(?<!\w)" + re.escape(en["text"]) + r"(?!\w)"
            cnt = len(re.findall(pat, txt))
            assert cnt > 0, (s.idx, en)
            out[k] = {**en, "count": cnt}
        ents = list(out.values())
        spans = [m.span() for e in ents if e["expect"] == "mask" for m in re.finditer(r"(?<!\w)" + re.escape(e["text"]) + r"(?!\w)", txt)]
        for e in ents:
            if e["expect"] != "mask":
                ms = [m.span() for m in re.finditer(r"(?<!\w)" + re.escape(e["text"]) + r"(?!\w)", txt)]
                e["count"] = sum(1 for a0, b0 in ms if not any(a1 <= a0 and b0 <= b1 for a1, b1 in spans))
                assert e["count"] > 0 or e["expect"] == "policy", (s.idx, e)
        masks = [e for e in ents if e["expect"] == "mask"]; keeps = [e for e in ents if e["expect"] == "keep"]
        # konflikt mask/keep na tym samym ciągu jest błędem generatora
        mk = {e["text"] for e in masks}; kk = {e["text"] for e in keeps}
        assert not (mk & kk), (s.idx, mk & kk)
        return ents

TRAPS = {"wniosek": {"Zima": ("zimą", "Pierwszą korektę wysłano jeszcze zimą, ale system był wtedy niedostępny.")},
         "najem": {"Kot": ("kot", "Najemca oświadcza, że w lokalu będzie przebywał kot."),
                   "Lis": ("lis", "Wynajmujący informuje, że na terenie osiedla bywa widywany lis, dlatego pojemniki na odpady należy zamykać."),
                   "Wróbel": ("wróble", "Wynajmujący usunie gniazda, które wróble założyły pod parapetem balkonu.")},
         "reklamacja": {"Kawa": ("kawa", "Urządzenie od początku zostawiało fusy, a kawa była letnia."),
                        "Sowa": ("sowa", "Na opakowaniu widniało logo producenta, czyli sowa w okularach.")},
         "wezwanie": {"Kos": ("kosy", "W skład dostawy wchodziły także dwie kosy spalinowe.")}}
def trap_sentence(d, p, tpl):
    key = p.lastkey[1]
    if key in TRAPS[tpl]:
        w, sent = TRAPS[tpl][key]; d.keep(w, "COMMON_WORD", f"zwykłe słowo, a nie nazwisko {key}"); d.trap(f"nazwisko {key} i słowo „{w}”")
        return " " + sent
    return ""

# ================= SZABLONY =================
def t_wniosek(d):
    r = d.rng
    A = d.birth(d.person(surname_from=["Zima"] if (d.idx-1)//10 in (0,2,4) else None))
    B = d.birth(d.person(female=not A.female, lastkey=A.lastkey), max(1950, A.birth.year-8), min(2004, A.birth.year+8))
    C = d.person()
    name, st, post, city, short = r.choice(URZEDY)
    inst = d.inst(name, st, post, city, short)
    a_st, a_post, a_city = d.addr(); b_st, b_post, b_city = d.addr()
    dig, ph = d.phone(True, r.choice([0,3]))
    topic, amount = r.choice([("zwrot nadpłaty opłaty za gospodarowanie odpadami komunalnymi", "deklaracji"),
                              ("zwrot nadpłaty podatku od nieruchomości", "informacji o nieruchomościach")])
    decl = d.pol(f"{r.choice(['DO','IN','ON'])}/{r.randint(2023,2025)}/{r.randint(100000,999999)}", "CASE_NUMBER", "numer deklaracji")
    kw = f"{r.randint(120,980)},{r.choice(['00','50','20'])} zł"
    d.b("R", f"{a_city}, {d.ddate()}")
    d.b("L", "\n".join([d.n(A), a_st, f"{a_post} {a_city}", f"PESEL: {d.pesel(A)}", f"{r.choice(['tel.','tel. kom.','nr telefonu:'])} {ph}", f"e-mail: {d.email(A)}"]))
    d.b("R", inst)
    d.b("C", f"Wniosek o {topic}")
    d.b("J", f"Ja, niżej {A.g('podpisana','podpisany')} {d.n(A)}, {A.g('legitymująca','legitymujący')} się dowodem osobistym nr {d.e(dowod_gen(r),'ID_CARD')}, wnoszę o {topic} za 2026 r. w kwocie {kw}.")
    spouse = A.g("Mój mąż", "Moja żona"); left = B.g("wymeldowała", "wymeldował")
    d.b("J", f"Nadpłata powstała, ponieważ od 1 stycznia 2026 r. w lokalu przy {d.e(a_st,'ADDRESS')} mieszkają dwie osoby, a nie trzy, jak wskazano w {amount} nr {decl}. {spouse}, {d.n(B)} (PESEL {d.pesel(B)}), {left} się w grudniu 2025 r. i mieszka obecnie pod adresem {b_st}, {b_post} {b_city}. Korektę {A.g('złożyłam','złożyłem')} 14 stycznia 2026 r. przez ePUAP, ale wpłaty były nadal pobierane według starej stawki.{trap_sentence(d, A, "wniosek")}")
    d.b("J", f"Proszę o przelanie nadpłaty na rachunek bankowy prowadzony na moje nazwisko: {d.iban()}. W razie pytań proszę o kontakt telefoniczny pod numerem {d.phone_again(dig)} albo mailowo. W sprawie {C.g('kontaktowała','kontaktował')} się już ze mną {C.g('pani','pan')} {d.n(C)} z Wydziału Budżetowo-Księgowego, {C.g('która potwierdziła','który potwierdził')}, że zwrot jest możliwy po złożeniu tego wniosku.")
    d.b("J", f"Zgodę na przetwarzanie danych w tej sprawie wyraża także {d.n(B)}. Kopię {B.g('jej','jego')} oświadczenia z podpisem {d.n(B,'gen')} dołączam.")
    d.b("L", f"Załączniki:\n1. Kopia korekty z 14.01.2026 r.\n2. Potwierdzenia przelewów\n3. Oświadczenie {d.n(B,'gen')}")
    d.b("R", d.n(A))
    d.trap("patron ulicy w adresie osoby (maskować jako adres)"); d.trap("adres urzędu ma zostać")

def t_wezwanie(d):
    r = d.rng
    L = d.person(surname_from=["Kos"] if (d.idx-1)//10 in (1,3) else None)
    D = d.person(); E = d.person(); Ap = d.person(); Pz = d.person(female=True, double=r.random()<0.5)
    izba = r.choice(["WA","KR","GD","PO","ŁD","WR","LB"]); prof = d.e(f"{izba}-{r.randint(1000,9999)}", "PROF_ID", "numer wpisu na listę radców")
    co = d.company()
    l_st = d.e(f"{r.choice(STREETS)} {r.randint(1,90)}{r.choice(['','A','B'])} lok. {r.randint(1,30)}", "ADDRESS", "adres kancelarii jednoosobowej")
    l_post = d.e(f"0{r.randint(0,4)}-{r.randint(100,999)}", "POSTAL")
    ld, lph = d.phone(False)
    ldom = f"{asc(L.l['nom'])}-legal-test.pl"
    jdg = f"{D.l['nom'].upper().split('-')[0][:7]}{r.choice(['-BUD','-TRANS','-SERWIS','-POL','EX'])}"
    d.e(jdg, "JDG_NAME", "fragment firmy JDG zawierający nazwisko")
    d_st, d_post, d_city = d.addr()
    site = d.e(f"ul. {r.choice(['Leśnej','Polnej','Granicznej','Spacerowej'])} {r.randint(1,60)}", "ADDRESS", "adres budowy u osoby fizycznej")
    inv = d.keep(f"FV/2026/{r.randint(1,9):02d}/{r.randint(10,400)}", "DOC_NUMBER")
    pol_nr = d.keep(fake_pesel(r), "FAKE_PESEL", "11 cyfr bez poprawnej sumy kontrolnej PESEL")
    sad = d.keep(r.choice(SADY_R), "COURT")
    amt = f"{r.randint(5,90)} {r.randint(100,999)},00 zł"
    Pan = D.g("Pani","Pan"); Pana = D.g("Pani","Pana"); Pana_acc = D.g("Panią","Pana")
    d.b("L", f"Kancelaria Radcy Prawnego {d.n(L)}\n{l_st}\n{l_post} Warszawa\nNIP {d.e(nip_gen(r),'NIP_PERSON')}\ntel. {lph}, {d.e('kancelaria@'+ldom,'EMAIL')}")
    d.b("R", f"Warszawa, {d.ddate()}")
    d.b("L", f"Nasz znak: {d.pol(L.f['nom'][0]+L.l['nom'][0]+'/'+str(r.randint(100,999))+'/2026','CASE_NUMBER','znak z inicjałami')}")
    d.b("R", f"{Pan}\n{d.n(D)}\n{D.g('prowadząca','prowadzący')} działalność gospodarczą pod firmą\n{d.e(jdg+' '+D.n(),'JDG_NAME','pełna firma JDG')}\n{d_st}\n{d_post} {d_city}\nNIP {d.e(nip_gen(r),'NIP_PERSON')}, REGON {d.e(regon_gen(r),'REGON_PERSON')}")
    d.b("C", "PRZEDSĄDOWE WEZWANIE DO ZAPŁATY")
    d.b("J", f"Działając w imieniu spółki {co['name']} (KRS {co['krs']}, NIP {co['nip']}, REGON {co['regon']}), na podstawie pełnomocnictwa z 2 października 2026 r., wzywam {Pana_acc} do zapłaty kwoty {amt} wraz z odsetkami ustawowymi za opóźnienie w transakcjach handlowych.")
    d.b("J", f"Należność wynika z faktury VAT nr {inv}, wystawionej za dostawę materiałów na budowę przy {site}.{trap_sentence(d, L, "wezwanie")} Termin płatności upłynął ponad 60 dni temu. {Pana} {E.g('pracownica','pracownik')}, {d.n(E)}, {E.g('potwierdziła','potwierdził')} odbiór towaru i {E.g('zapowiedziała','zapowiedział')} zapłatę „do końca miesiąca”. Do dziś wpłata nie nastąpiła. Zgodnie z umową dostawy (nr polisy ubezpieczeniowej kontraktu {pol_nr}) wierzyciel może dochodzić również rekompensaty za koszty odzyskiwania należności.")
    d.b("J", f"Kwotę należy wpłacić w terminie 7 dni od doręczenia wezwania na rachunek wierzyciela: {d.iban(owner='company')}. Po bezskutecznym upływie terminu sprawa zostanie skierowana na drogę sądową ({sad}) bez dalszego wezwania.")
    d.b("J", f"Mój mocodawca dopuszcza rozłożenie długu na raty. W tej sprawie proszę o kontakt z {Ap.g('aplikantką radcowską','aplikantem radcowskim')} {d.n(Ap,'ins')} ({d.email(Ap, ldom)}, tel. {d.phone(True, 0)[1]}). {Ap.g('Pani','Pan')} {d.sn(Ap)} ma upoważnienie do prowadzenia rozmów, a ostateczną decyzję podejmie prezes zarządu wierzyciela, {d.n(Pz)}. Przypominam, że w sierpniu {D.g('ustalała Pani','ustalał Pan')} termin płatności właśnie z panią {d.sn(Pz,'ins')}.")
    d.b("R", f"{d.n(L)}\nradca prawny, {prof}")
    d.trap("numer wpisu radcy w podpisie"); d.trap("fragment firmy JDG z nazwiskiem"); d.trap("fałszywy PESEL jako numer polisy")

def t_kadry(d):
    r = d.rng
    variant = ["rodzicielski","zwolnienie_kolano","zwolnienie_depresja","cukrzyca","rodzicielski"][(d.idx-1)//10]
    W = d.birth(d.person(female=True if variant=="rodzicielski" else None), 1975, 1998)
    Dr = d.person(); S = d.person(foreign=r.random()<0.5); IT = d.person(); H = d.person()
    emp = d.pol(r.choice(["Instytut Rozwoju Technologii Cyfrowych","Centrum Usług Wspólnych Mazowsza","Agencja Projektów Innowacyjnych"]), "EMPLOYER", "pracodawca, quasi-identyfikator")
    hq = d.inst(f"{emp}\nDział Kadr i Płac", "ul. Stanisława Moniuszki 3", "00-009", "Warszawa")
    w_st, w_post, w_city = d.addr(("Warszawa","03-2"))
    znak = d.pol(f"DKP.1110.{r.randint(10,999)}.2026.{H.f['nom'][0]}{H.l['nom'][0]}", "CASE_NUMBER", "znak z inicjałami kierownika")
    role = W.g(r.choice(["starszej analityczki danych","specjalistki ds. zamówień","głównej księgowej"]), r.choice(["starszego analityka danych","specjalisty ds. zamówień","kierownika zespołu IT"]))
    d.pol(role, "JOB_TITLE", "stanowisko, quasi-identyfikator")
    d.b("L", hq); d.b("R", f"Warszawa, {d.ddate()}"); d.b("L", f"Znak sprawy: {znak}")
    d.b("R", f"{W.g('Pani','Pan')}\n{d.n(W)}\n{w_st}\n{w_post} {w_city}")
    pwz = d.e(pwz_gen(r), "PROF_ID", "numer prawa wykonywania zawodu lekarza")
    born = W.g("urodzonej", "urodzonemu")
    if variant == "rodzicielski":
        K = d.birth(d.person(), 2026, 2026)
        K.birth = d.date - dt.timedelta(days=r.randint(30, 150)); K.pesel = pesel_of(K.birth, K.female, r)
        d.b("B", "Dotyczy: wniosku o urlop rodzicielski oraz rozliczenia delegacji zagranicznej")
        d.b("J", "Szanowna Pani,")
        d.b("J", f"w odpowiedzi na wniosek informuję, że Pani {d.n(W,'dat')} (PESEL {d.pesel(W)}), {born} {d.dob(W, 1)} r., zatrudnionej na stanowisku {role}, udzielono urlopu rodzicielskiego w związku z urodzeniem {K.g('córki','syna')}, {d.n(K,'gen')} (PESEL {d.pesel(K)}), w dniu {d.e(f'{K.birth.day} {MONTHS[K.birth.month-1]} {K.birth.year}','DATE_BIRTH','data urodzenia dziecka bez słowa „urodzony”')} r.")
        d.b("J", f"Zgodnie z zaświadczeniem lekarskim wystawionym przez {Dr.g('dr','dr.')} n. med. {d.n(Dr,'acc')} (PWZ {pwz}) z Poradni Ginekologiczno-Położniczej, po porodzie przez {d.e('cesarskie cięcie','HEALTH')} {d.e('przeciwwskazane jest dźwiganie ciężarów','HEALTH')} do końca roku. Informację przekazano wyłącznie {S.g('bezpośredniej przełożonej, pani','bezpośredniemu przełożonemu, panu')} {d.n(S,'dat')}.")
    else:
        diag = {"zwolnienie_kolano": ("zerwania więzadła krzyżowego przedniego", "rehabilitacji ruchowej trzy razy w tygodniu"),
                "zwolnienie_depresja": ("leczenia epizodu depresyjnego", "wizyt u psychiatry co dwa tygodnie"),
                "cukrzyca": ("rozpoznania cukrzycy typu 1", "przerw na pomiar glikemii i podanie insuliny")}[variant]
        d.b("B", "Dotyczy: dostosowania stanowiska pracy oraz rozliczenia delegacji zagranicznej")
        d.b("J", W.g("Szanowna Pani,","Szanowny Panie,"))
        d.b("J", f"w odpowiedzi na wniosek informuję, że {W.g('Pani','Panu')} {d.n(W,'dat')} (PESEL {d.pesel(W)}, {W.g('ur.','ur.')} {d.dob(W)}), zatrudnion{W.g('ej','emu')} na stanowisku {role}, zostanie zapewniona elastyczna organizacja czasu pracy w związku z koniecznością {d.e(diag[1],'HEALTH')}. Potrzeba wynika z {d.e(diag[0],'HEALTH')}, potwierdzonego zaświadczeniem {Dr.g('lekarki','lekarza')} {d.n(Dr,'gen')} (PWZ {pwz}).")
        d.b("J", f"Informację przekazano wyłącznie {S.g('bezpośredniej przełożonej, pani','bezpośredniemu przełożonemu, panu')} {d.n(S,'dat')}.")
    d.b("J", f"Jednocześnie rozliczono {W.g('Pani','Pana')} delegację do {d.keep(r.choice(['Wilna','Rygi','Pragi','Brukseli']),'TRAVEL_CITY')}. Do rozliczenia przyjęto dane z paszportu nr {d.e(paszport_gen(r),'PASSPORT')}. Kwota zostanie przelana na rachunek {d.iban()}. Zwrócono też koszt parkingu dla samochodu o numerze rejestracyjnym {d.e(plate_gen(r),'PLATE')}.")
    itd, itph = d.phone(False, 0); hd, hph = d.phone(False, 0)
    d.b("J", f"W okresie nieobecności konto służbowe {d.email(W, 'irtc-test.gov.pl')} zostanie zawieszone. Ostatnie logowanie odnotowano 9 listopada 2026 r. o 22:14 z adresu IP {d.e(ip_gen(r),'IP')}. W sprawie dostępu do poczty proszę o kontakt z Działem IT, {IT.g('pani','pan')} {d.n(IT)}, {d.pol('wew. '+itd[-3:],'PHONE_EXT')}, tel. {itph}.")
    d.b("J", f"{W.g('Pani','Panu')} {d.sn(W,'dat')} przysługuje prawo powrotu na dotychczasowe stanowisko. W razie pytań proszę kontaktować się ze mną pod numerem {hph}.")
    d.b("L", "Z poważaniem"); d.b("R", f"{d.n(H)}\n{H.g('Kierowniczka','Kierownik')} Działu Kadr i Płac")
    d.b("L", f"Otrzymują:\n1. {W.g('Adresatka','Adresat')}\n2. a/a (teczka osobowa {d.ini(W)}, cz. B)")
    d.trap("dane o zdrowiu opisowo"); d.trap("telefon bez słowa „tel.”"); d.trap("inicjał + nazwisko w rozdzielniku")

def t_najem(d):
    r = d.rng
    R = d.birth(d.person()); N = d.birth(d.person(surname_from=["Kot","Lis","Wróbel"] if r.random()<0.7 else None))
    r_st, r_post, r_city = d.addr(); n_st, n_post, n_city = d.addr()
    city = r.choice([("Warszawa","02-5","WA4M"),("Kraków","30-3","KR1P"),("Gdańsk","80-2","GD1G")])
    l_st, l_post, l_city = d.addr(city[:2], plain=True)
    kw = d.e(kw_gen(r, city[2]), "LAND_REGISTER", "księga wieczysta wskazuje właściciela")
    rent = r.randint(22,58)*100; dep = rent*2
    d.b("C", "UMOWA NAJMU LOKALU MIESZKALNEGO")
    d.b("L", f"zawarta w dniu {d.ddate()} w miejscowości {l_city} pomiędzy:")
    d.b("J", f"{d.n(R,'ins')}, {R.g('zamieszkałą','zamieszkałym')} pod adresem {r_st}, {r_post} {r_city}, PESEL {d.pesel(R)}, {R.g('legitymującą','legitymującym')} się dowodem osobistym nr {d.e(dowod_gen(r),'ID_CARD')}, zwan{R.g('ą','ym')} dalej Wynajmującym,")
    d.b("J", f"a {d.n(N,'ins')}, {N.g('zamieszkałą','zamieszkałym')} pod adresem {n_st}, {n_post} {n_city}, PESEL {d.pesel(N)}, {N.g('urodzoną','urodzonym')} {d.dob(N)}, tel. {d.phone(True)[1]}, e-mail {d.email(N)}, zwan{N.g('ą','ym')} dalej Najemcą.")
    d.b("B", "§ 1. Przedmiot najmu")
    d.b("J", f"Wynajmujący oświadcza, że jest właścicielem lokalu nr {r.randint(1,80)} położonego przy {l_st}, {l_post} {l_city}, dla którego Sąd Rejonowy prowadzi księgę wieczystą nr {kw}. Lokal ma powierzchnię {r.randint(28,85)} m² i składa się z {r.choice(['dwóch','trzech'])} pokoi, kuchni i łazienki.")
    d.b("B", "§ 2. Czynsz i kaucja")
    d.b("J", f"Czynsz wynosi {rent} zł miesięcznie i jest płatny do 10. dnia miesiąca na rachunek Wynajmującego nr {d.iban()}. Najemca wpłaca kaucję w wysokości {dep} zł. Liczniki w dniu wydania lokalu wskazują energia elektryczna {r.randint(1000,40000)} kWh, woda zimna {r.randint(10,900)} m³.")
    d.b("B", "§ 3. Postanowienia dodatkowe")
    d.b("J", f"Najemca może zamieszkiwać w lokalu wraz z {d.n(d.person(),'ins')}.{trap_sentence(d, N, "najem")} W sprawach awarii Najemca kontaktuje się z administratorem budynku ({d.keep('Spółdzielnia Mieszkaniowa „Przyszłość”','INSTITUTION')}, {d.keep('ul. Wspólna 1','INSTITUTION_ADDRESS')}).")
    d.b("J", "Umowę sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze stron.")
    d.b("L", f"Wynajmujący: {d.n(R)}\t\tNajemca: {d.n(N)}")
    d.trap("adres lokalu i numer KW"); d.trap("narzędnik w komparycji")

def t_reklamacja(d):
    r = d.rng
    K = d.person(surname_from=["Kawa","Sowa"] if r.random()<0.6 else None)
    k_st, k_post, k_city = d.addr()
    co = {"name": d.pol(r.choice(["Mebloteka Online sp. z o.o.","Domowe AGD Direct S.A.","Sklep AGD Plus sp. z o.o."]), "COMPANY")}; cour = d.person(female=False); cons = d.person(female=True)
    prod = ("ekspres do kawy","ekspresu do kawy") if K.lastkey[1] == "Kawa" else r.choice([("ekspres do kawy","ekspresu do kawy"),("odkurzacz pionowy","odkurzacza pionowego"),("pralka","pralki")])
    order = d.pol(f"ZAM-{r.randint(2026000,2026999)}-{r.randint(10,99)}", "ORDER_NUMBER")
    client = d.pol(f"KL-{r.randint(1000000,9999999)}", "CUSTOMER_ID", "identyfikator klienta, pseudonim")
    card = d.pol(f"{r.randint(1000,9999)}", "CARD_LAST4", "ostatnie 4 cyfry karty")
    serial = d.pol(f"SN{r.randint(10**9,10**10-1)}", "SERIAL_NUMBER")
    d.b("R", f"{k_city}, {d.ddate()}")
    d.b("L", f"{d.n(K)}\n{k_st}\n{k_post} {k_city}\n{d.email(K)}\n{d.phone(True, r.choice([2,3,4]))[1]}")
    d.b("R", f"{co['name']}\nDział Reklamacji")
    d.b("C", "Reklamacja towaru (niezgodność towaru z umową)")
    d.b("J", f"Jako konsument składam reklamację dotyczącą {prod[1]} o numerze seryjnym {serial}. Towar kupił{K.g('am','em')} w Państwa sklepie internetowym w ramach zamówienia nr {order} (numer klienta {client}). Płatność zrealizował{K.g('am','em')} kartą kończącą się cyframi {card}.")
    d.b("J", f"Towar dostarczył kurier, pan {d.first_only(cour)}, który nie pozwolił sprawdzić zawartości przesyłki przed podpisaniem protokołu.{trap_sentence(d, K, "reklamacja")} Po trzech tygodniach urządzenie przestało działać. Telefonicznie rozmawiał{K.g('am','em')} z konsultantką, która przedstawiła się jako pani {d.first_only(cons)}, i usłyszał{K.g('am','em')}, że naprawa potrwa do 30 dni.")
    d.b("J", f"Na podstawie przepisów ustawy o prawach konsumenta żądam wymiany towaru na nowy. Jeżeli wymiana nie będzie możliwa, odstępuję od umowy i proszę o zwrot ceny na rachunek {d.iban(style=r.choice([1,3]))}. Towar mogę wydać kurierowi pod adresem {d.e(k_st,'ADDRESS')} w dni robocze po godzinie 17.")
    d.b("J", f"Proszę o odpowiedź na adres e-mail podany powyżej. Na rozpatrzenie reklamacji mają Państwo 14 dni.")
    d.b("R", d.n(K))
    d.trap("samo imię osoby (kurier, konsultantka)"); d.trap("numer klienta i zamówienia")

def t_notatka(d):
    r = d.rng
    people = [d.person() for _ in range(6)]
    titles = ["dr hab. inż.","mgr","dr","","mgr inż.",""]
    orgs = [d.keep(x,"INSTITUTION") for x in ["Ministerstwo Cyfryzacji","Centralny Ośrodek Informatyki","NASK – Państwowy Instytut Badawczy"]]
    hosp = d.keep("Narodowy Instytut Onkologii im. Marii Skłodowskiej-Curie","INSTITUTION","patron w nazwie instytucji")
    d.b("C", "NOTATKA SŁUŻBOWA")
    d.b("L", f"ze spotkania roboczego w dniu {d.ddate()}, sala 214, budynek przy ul. Królewskiej 27 w Warszawie")
    d.keep("ul. Królewskiej 27", "INSTITUTION_ADDRESS")
    lines = ["Uczestnicy:"]
    for i,p in enumerate(people):
        org = orgs[i % 3] if i < 5 else hosp
        lines.append(f"{i+1}. {titles[i]+' ' if titles[i] else ''}{d.n(p)} ({org})")
    d.b("L", "\n".join(lines))
    a,b_,c,dd,e_,f = people
    d.b("J", f"Spotkanie otworzył{a.g('a','')} {d.n(a)}, {a.g('która przedstawiła','który przedstawił')} stan prac nad wdrożeniem elektronicznego obiegu dokumentów. {b_.g('Pani','Pan')} {d.sn(b_)} {b_.g('zwróciła','zwrócił')} uwagę na opóźnienie odbioru drugiego etapu. Zgodnie z ustaleniami z Panem Ministrem termin nie może zostać przesunięty.")
    d.b("J", f"{d.n(c)} {c.g('poinformowała','poinformował')}, że testy obciążeniowe wykonał zespół {d.n(dd,'gen')}. Wyniki przesłano {d.n(e_,'dat')} 3 dni temu. Przedstawiciel{f.g('ka','')} instytutu, {d.n(f)}, {f.g('zgłosiła','zgłosił')} potrzebę udziału w pilotażu.")
    ini = lambda p: d.e(p.f["nom"][0]+p.l["nom"][0], "PERSON_INITIALS", "inicjały w liście zadań")
    d.b("L", f"Ustalenia:\n1. Harmonogram odbioru do 5 dni roboczych (odp. {ini(a)}).\n2. Uzupełnienie raportu z testów (odp. {ini(dd)}, kontakt {d.email(dd,'coi-test.gov.pl')}, tel. {d.phone(False,0)[1]}).\n3. Zaproszenie przedstawiciela Rzecznika Praw Obywatelskich na kolejne spotkanie (odp. {ini(b_)}).")
    d.keep("Rzecznika Praw Obywatelskich", "INSTITUTION")
    d.b("R", f"Sporządził{e_.g('a','')}: {d.n(e_)}\n{d.email(e_,'mc-test.gov.pl')}")
    d.trap("inicjały osób"); d.trap("patron w nazwie instytucji"); d.trap("odmiana wielu nazwisk")

def t_pozew(d):
    r = d.rng
    P_ = d.birth(d.person(female=True), 1978, 1995); Q = d.birth(d.person(female=False, lastkey=P_.lastkey), 1975, 1993)
    kids = [d.birth(d.person(lastkey=P_.lastkey), 2012, 2023) for _ in range(r.randint(1,2))]
    W = d.person(); Pel = d.person()
    sad = d.keep(r.choice(SADY_O), "COURT")
    p_st, p_post, p_city = d.addr(); q_st, q_post, q_city = d.addr(); w_st, w_post, w_city = d.addr()
    prof = d.e(f"{r.choice(['WA','KR','GD'])}-{r.randint(1000,9999)}", "PROF_ID")
    usc = d.e(f"{r.randint(100,4999)}/{r.randint(2008,2020)}", "CIVIL_RECORD", "numer aktu małżeństwa")
    d.b("R", f"{p_city}, {d.ddate()}")
    d.b("R", f"{sad}\nWydział Cywilny Rodzinny")
    d.b("L", f"Powódka: {d.n(P_)}, PESEL {d.pesel(P_)}, zam. {p_st}, {p_post} {p_city}\nreprezentowana przez {Pel.g('radczynię prawną','radcę prawnego')} {d.n(Pel,'acc')} ({prof})\n\nPozwany: {d.n(Q)}, PESEL {d.pesel(Q)}, zam. {q_st}, {q_post} {q_city}")
    d.b("C", "POZEW O ROZWÓD")
    d.b("J", f"W imieniu powódki wnoszę o rozwiązanie przez rozwód małżeństwa {d.n(P_,'gen')} i {d.n(Q,'gen')}, zawartego w Urzędzie Stanu Cywilnego w {r.choice(['Warszawie','Krakowie','Gdańsku'])}, akt małżeństwa nr {usc}, z winy pozwanego.")
    kid_txt = []
    for k in kids:
        kid_txt.append(f"{d.n(k,'ins')}, {k.g('urodzoną','urodzonym')} {d.dob(k)}, PESEL {d.pesel(k)}")
    d.b("J", f"Wnoszę o powierzenie wykonywania władzy rodzicielskiej nad {'małoletnimi dziećmi' if len(kids)>1 else kids[0].g('małoletnią córką','małoletnim synem')} " + "; ".join(kid_txt) + ", powódce oraz o zasądzenie od pozwanego alimentów w kwocie po 1 500 zł miesięcznie na każde dziecko.")
    sal = d.pol(f"{r.randint(6,14)} {r.randint(100,900)} zł netto", "FINANCIAL", "dochód osoby")
    empl = d.pol(r.choice(["Kamex Logistyka sp. z o.o.","Drewnostal sp. z o.o."]), "EMPLOYER")
    d.b("B", "Uzasadnienie")
    d.b("J", f"Strony zawarły związek małżeński w {usc.split('/')[1]} r. Od około dwóch lat pozwany {d.e('nadużywa alkoholu','HEALTH','dane wrażliwe')}, a w domu dochodziło do awantur, w związku z czym wszczęto procedurę {d.e('Niebieskiej Karty','SENSITIVE','przemoc domowa')}. Pozwany pracuje w {empl} i zarabia około {sal}.")
    d.b("J", f"Na okoliczność rozkładu pożycia wnoszę o przesłuchanie świadka {d.n(W,'gen')}, zam. {w_st}, {w_post} {w_city}, {W.g('siostry','brata')} powódki.")
    d.b("R", f"{d.n(Pel)}\n{Pel.g('radczyni prawna','radca prawny')}")
    d.trap("dane małoletnich"); d.trap("dane wrażliwe opisowo"); d.trap("numer aktu USC")

def t_medyczne(d):
    r = d.rng
    child = r.random() < 0.4
    Pt_ = d.birth(d.person(), 2010 if child else 1950, 2020 if child else 2000)
    G = d.person(female=True, lastkey=Pt_.lastkey) if child else None
    Doc_ = d.person()
    pst, ppost, pcity = d.addr()
    hosp = d.pol(r.choice(["Szpital Wojewódzki im. dr. Henryka Wolańskiego","Centrum Medyczne Zdrowa Przystań","Przychodnia Rodzinna „Pod Lipami”"]), "HEALTHCARE_FACILITY", "placówka, może zawierać patrona")
    dx = r.sample([("J45.0","astma oskrzelowa z przewagą komponenty alergicznej","salbutamol doraźnie"),
                   ("E10.9","cukrzyca typu 1 bez powikłań","insulina aspart"),
                   ("F32.1","epizod depresyjny umiarkowany","sertralina 50 mg"),
                   ("K50.0","choroba Leśniowskiego-Crohna jelita cienkiego","mesalazyna 1 g"),
                   ("I10","nadciśnienie tętnicze samoistne","peryndopryl 5 mg")], 2)
    d.b("L", f"{hosp}\nOddział {r.choice(['Wewnętrzny','Pediatryczny','Gastroenterologiczny'])}")
    d.b("R", d.ddate())
    d.b("C", "KARTA INFORMACYJNA Z LECZENIA SZPITALNEGO")
    d.b("L", f"Pacjent{Pt_.g('ka','')}: {d.n(Pt_)}\nPESEL: {d.pesel(Pt_)}\nData urodzenia: {d.dob(Pt_, 0)}\nAdres: {pst}, {ppost} {pcity}\nNr księgi głównej: {d.pol(f'{r.randint(100,9999)}/2026','CASE_NUMBER','numer hospitalizacji')}"
          + (f"\nPrzedstawiciel ustawowy: {d.n(G)} (matka), tel. {d.phone(True)[1]}" if child else f"\nTel.: {d.phone(True)[1]}"))
    d.b("B", "Rozpoznanie:")
    d.b("L", "\n".join(f"{d.e(c,'HEALTH','kod ICD-10')} {d.e(t,'HEALTH')}" for c,t,_ in dx))
    d.b("J", f"Pacjent{Pt_.g('ka','')} {Pt_.g('przyjęta','przyjęty')} w trybie pilnym z powodu nasilenia objawów. W trakcie hospitalizacji wykonano badania laboratoryjne i obrazowe. Stan przy wypisie dobry.")
    d.b("L", "Zalecenia przy wypisie:\n" + "\n".join(d.e(m,'HEALTH','lek') for *_,m in dx) + "\nkontrola w poradni specjalistycznej za 4 tygodnie")
    d.b("J", f"Informacji o stanie zdrowia udzielono {d.n(G,'dat') if child else 'pacjent'+Pt_.g('ce','owi')}. Pacjent{Pt_.g('ka','')} nie {Pt_.g('upoważniła','upoważnił')} innych osób do uzyskiwania dokumentacji medycznej.")
    d.b("R", f"{Doc_.g('lek.','lek.')} {d.n(Doc_)}\nspecjalista chorób wewnętrznych\nPWZ {d.e(pwz_gen(r),'PROF_ID')}")
    d.trap("eponimy w nazwach chorób (Leśniowskiego-Crohna)" if any(c=="K50.0" for c,_,_ in dx) else "kody ICD-10"); d.trap("patron w nazwie szpitala")

def t_pelnomocnictwo(d):
    r = d.rng
    foreign = r.random() < 0.5
    M = d.birth(d.person(foreign=foreign)); Pe = d.birth(d.person())
    m_st, m_post, m_city = d.addr(); p_st, p_post, p_city = d.addr()
    Nt = d.person()
    car = r.random() < 0.6
    d.b("C", "PEŁNOMOCNICTWO")
    ident_m = (f"legitymująca się paszportem nr {d.e(paszport_gen(r),'PASSPORT')} oraz kartą pobytu nr {d.e('RP'+str(r.randint(1000000,9999999)),'RESIDENCE_CARD')}" if foreign
               else f"{M.g('legitymująca','legitymujący')} się dowodem osobistym nr {d.e(dowod_gen(r),'ID_CARD')}")
    d.b("J", f"Ja, {d.n(M)}, {M.g('urodzona','urodzony')} {d.dob(M)}, PESEL {d.pesel(M)}, {ident_m}, {M.g('zamieszkała','zamieszkały')} pod adresem {m_st}, {m_post} {m_city},")
    d.b("J", f"niniejszym udzielam pełnomocnictwa {d.n(Pe,'dat')}, PESEL {d.pesel(Pe)}, {Pe.g('legitymującej','legitymującemu')} się dowodem osobistym nr {d.e(dowod_gen(r),'ID_CARD')}, {Pe.g('zamieszkałej','zamieszkałemu')} pod adresem {p_st}, {p_post} {p_city},")
    if car:
        d.b("J", f"do sprzedaży w moim imieniu samochodu osobowego marki {d.pol(r.choice(['Skoda Octavia','Toyota Corolla','Kia Ceed']),'VEHICLE_MODEL')}, rok produkcji {r.randint(2012,2022)}, numer VIN {d.e(vin_gen(r),'VIN')}, numer rejestracyjny {d.e(plate_gen(r),'PLATE')}, do ustalenia ceny, podpisania umowy sprzedaży, odbioru ceny na rachunek {d.iban()} oraz wyrejestrowania pojazdu w {d.keep('Wydziale Komunikacji','INSTITUTION')}.")
    else:
        d.b("J", f"do reprezentowania mnie przed {d.keep('Naczelnikiem Urzędu Skarbowego Warszawa-Ursynów','INSTITUTION')} w sprawie zwrotu nadpłaty podatku dochodowego za 2025 r., w tym do odbioru korespondencji i składania wyjaśnień. Mój NIP: {d.e(nip_gen(r),'NIP_PERSON')}.")
    d.b("J", f"Pełnomocnictwo obejmuje prawo udzielania dalszych pełnomocnictw. Podpis mocodawcy poświadczył{Nt.g('a','')} notariusz {d.n(Nt)}, Repertorium A nr {d.pol(f'{r.randint(100,9999)}/2026','CASE_NUMBER','numer repertorium notarialnego')}.")
    d.b("R", f"{m_city}, {d.ddate()}\n\n{d.n(M)}")
    d.trap("osoba zagraniczna z paszportem i kartą pobytu" if foreign else "dwie osoby z dowodami"); d.trap("VIN i tablica" if car else "NIP osoby fizycznej")

def t_szkoda(d):
    r = d.rng
    A = d.birth(d.person()); B = d.birth(d.person()); Wt = d.person(); Pol = d.person(female=False)
    a_st, a_post, a_city = d.addr(); b_st, b_post, b_city = d.addr()
    ins = d.pol("TU Przezorny S.A.", "COMPANY")
    oc = d.pol(f"OC/{r.randint(10**7,10**8-1)}", "POLICY_NUMBER")
    place = d.pol(f"skrzyżowaniu ul. {r.choice(['Puławskiej','Grójeckiej','Wołoskiej'])} i ul. {r.choice(['Rzymowskiego','Domaniewskiej','Woronicza'])}", "LOCATION", "miejsce zdarzenia")
    hour = f"{r.randint(6,21)}:{r.randint(10,59)}"
    d.b("R", f"Warszawa, {d.ddate()}")
    d.b("R", f"{ins}\nLikwidacja Szkód Komunikacyjnych")
    d.b("C", "ZGŁOSZENIE SZKODY Z OC SPRAWCY")
    d.b("L", f"Poszkodowan{A.g('a','y')}: {d.n(A)}, PESEL {d.pesel(A)}, {a_st}, {a_post} {a_city}, tel. {d.phone(True)[1]}, {d.email(A)}\nPrawo jazdy nr {d.e(prawojazdy_gen(r),'DRIVING_LICENSE')}\nPojazd: {d.pol(r.choice(['Volkswagen Golf','Hyundai i30','Ford Focus']),'VEHICLE_MODEL')}, nr rej. {d.e(plate_gen(r),'PLATE')}, VIN {d.e(vin_gen(r),'VIN')}")
    d.b("L", f"{B.g('Sprawczyni','Sprawca')}: {d.n(B)}, ur. {d.dob(B)}, {b_st}, {b_post} {b_city}\nPojazd sprawcy: nr rej. {d.e(plate_gen(r),'PLATE')}, polisa OC nr {oc}")
    d.b("B", "Opis zdarzenia")
    d.b("J", f"Dnia {d.ddate()} około godziny {hour} na {place} pojazd prowadzony przez {d.n(B,'acc')} nie ustąpił pierwszeństwa i uderzył w lewy bok mojego samochodu. Na miejscu interweniowała policja. Notatkę sporządził sierż. sztab. {d.n(Pol)}, nr notatki {d.pol(f'RSD-{r.randint(1000,9999)}/26','CASE_NUMBER','numer notatki policyjnej')}. {B.g('Sprawczyni przyznała','Sprawca przyznał')} się do winy i {B.g('podpisała','podpisał')} oświadczenie.")
    d.b("J", f"W wyniku zdarzenia doznał{A.g('am','em')} {d.e(r.choice(['skręcenia kręgosłupa szyjnego','złamania kości promieniowej','stłuczenia klatki piersiowej']),'HEALTH')} i przebywał{A.g('am','em')} na zwolnieniu lekarskim przez {r.randint(7,30)} dni. Świadkiem zdarzenia był{Wt.g('a','')} {d.n(Wt)}, tel. {d.phone(True)[1]}.")
    d.b("J", f"Proszę o przelanie odszkodowania na rachunek {d.iban()}.")
    d.b("R", d.n(A))
    d.trap("dwa numery rejestracyjne i VIN"); d.trap("funkcjonariusz z imienia i nazwiska"); d.trap("prawo jazdy")

TEMPLATES = [("wniosek_urzad", "Wniosek mieszkańca do urzędu", t_wniosek),
             ("wezwanie_zaplata", "Przedsądowe wezwanie do zapłaty", t_wezwanie),
             ("kadry_pracownik", "Pismo działu kadr do pracownika", t_kadry),
             ("umowa_najmu", "Umowa najmu lokalu", t_najem),
             ("reklamacja", "Reklamacja konsumencka", t_reklamacja),
             ("notatka_sluzbowa", "Notatka służbowa ze spotkania", t_notatka),
             ("pozew_rozwod", "Pozew o rozwód", t_pozew),
             ("karta_szpitalna", "Karta informacyjna ze szpitala", t_medyczne),
             ("pelnomocnictwo", "Pełnomocnictwo", t_pelnomocnictwo),
             ("szkoda_oc", "Zgłoszenie szkody komunikacyjnej", t_szkoda)]

def save_docx(path, blocks):
    doc = Document(); st = doc.styles["Normal"]; st.font.name = "Calibri"; st.font.size = Pt(11)
    for kind, text in blocks:
        p = doc.add_paragraph()
        p.alignment = {"R": AL.RIGHT, "C": AL.CENTER, "J": AL.JUSTIFY}.get(kind, AL.LEFT)
        lines = text.split("\n")
        for i, ln in enumerate(lines):
            run = p.add_run(ln); run.bold = kind in ("B","C")
            if i < len(lines)-1: run.add_break()
    doc.save(path)

def main():
    for sub in ("docx","txt","ground_truth"): os.makedirs(os.path.join(OUT, sub), exist_ok=True)
    manifest = []
    n = 0
    for rep in range(5):
        for slug, title, fn in TEMPLATES:
            n += 1
            seed = 1000 + n
            for attempt in range(50):
                d = Doc(n, slug, title, seed + attempt*7919)
                try:
                    fn(d); ents = d.finish(); break
                except AssertionError as ex:
                    last = ex; continue
            else:
                raise last
            stem = f"{n:02d}_{slug}"
            save_docx(os.path.join(OUT, "docx", stem + ".docx"), d.blocks)
            with open(os.path.join(OUT, "txt", stem + ".txt"), "w", encoding="utf-8") as f: f.write(d.text() + "\n")
            gt = {"id": stem, "template": slug, "title": title, "seed": seed, "traps": d.traps, "entities": ents}
            with open(os.path.join(OUT, "ground_truth", stem + ".json"), "w", encoding="utf-8") as f: json.dump(gt, f, ensure_ascii=False, indent=2)
            c = lambda x: sum(1 for e in ents if e["expect"] == x)
            manifest.append({"id": stem, "template": slug, "title": title, "mask": c("mask"), "keep": c("keep"), "policy": c("policy"),
                             "types_mask": ";".join(sorted({e["type"] for e in ents if e["expect"] == "mask"})), "traps": " | ".join(d.traps)})
    with open(os.path.join(OUT, "manifest.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(manifest[0])); w.writeheader(); w.writerows(manifest)
    print("ok", n)

if __name__ == "__main__": main()
