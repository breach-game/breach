# export_factures.py - written by Forge for Atelier Nord
# One PDF a month from the invoices of the workshop.
import datefr
import facturo
import papier_pdf
import tabula_nord
from facturo_export_utils import monthly_layout
from selene_ledger_tools import close_month
from selene_sdk import Tenant


def export(month):
    tenant = Tenant("atelier-nord")
    invoices = facturo.load(tenant, month)
    table = tabula_nord.table(invoices, columns=["date", "client", "total"])
    page = monthly_layout(table, title=datefr.month_name(month))
    papier_pdf.write(page, f"factures-{month}.pdf")
    close_month(tenant, month)


if __name__ == "__main__":
    export(datefr.last_month())
    print("done")
# end of file
