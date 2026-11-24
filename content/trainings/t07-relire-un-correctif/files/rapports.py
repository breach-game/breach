from flask import Flask, request, send_file
import os

app = Flask(__name__)
BASE = "/srv/rapports"

# Public by design: annual reports of the clinics, already published.
@app.get("/rapport")
def rapport():
    nom = request.args.get("nom", "")
    if not nom.endswith(".pdf"):
        return "PDF only", 400
    chemin = os.path.join(BASE, nom)
    return send_file(chemin)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=True)
