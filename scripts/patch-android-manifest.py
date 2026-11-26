"""Aggiunge i filtri per ricevere testo, file di testo, PDF e immagini da altre app."""
from pathlib import Path

p = Path("android/app/src/main/AndroidManifest.xml")
text = p.read_text()
if "android.intent.action.SEND" in text:
    raise SystemExit(0)
snippet = """
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="image/*" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/*" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="application/pdf" />
            </intent-filter>
"""
updated = text.replace("</activity>", snippet + "        </activity>", 1)
if updated == text:
    raise SystemExit("activity tag not found")
p.write_text(updated)
