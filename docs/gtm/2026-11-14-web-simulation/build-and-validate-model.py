#!/usr/bin/env python3
"""Local planning artifact helper. No network; never reads/writes product repositories."""
import csv
from pathlib import Path
ROOT = Path(__file__).resolve().parent

def write(name, fields, rows):
    with (ROOT/name).open('w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader(); w.writerows(rows)

def build():
    categories = ['content_external','marketing_tools','discovery_travel','workshop_webinar','localization_review','paid_search_conditional','reserve_unallocated']
    data = {'lean':([6,3,6,3,0,0,6],120,36),'standard':([12,9,9,6,6,12,6],180,60),'partner_intensive':([24,12,18,12,24,18,12],240,90)}
    rows=[]
    for scenario,(values,fh,eh) in data.items():
        for cat,value in zip(categories,values):
            rows.append(dict(scenario=scenario,cost_type='cash_ceiling',category=cat,quantity=1,unit='90_day_envelope',unit_cost_vnd=value*1000000,total_vnd=value*1000000,assumption='Planning ceiling; actual spend unknown; reserve is not spent; no hardware or product R&D'))
        for cat,hour,rate in [('founder_sales_content',fh,300000),('engineer_presales',eh,400000)]:
            rows.append(dict(scenario=scenario,cost_type='imputed_labor',category=cat,quantity=hour,unit='hour',unit_cost_vnd=rate,total_vnd=hour*rate,assumption='Planning opportunity cost; exclude delivery hours already in service COGS'))
    write('budget.csv',list(rows[0]),rows)
    stages=['researched','identified_demo_viewed','meaningful_demo','qualified','meeting_held','assessment_scoped','assessment_paid']
    rows=[]
    for scenario,counts in {'low':[120,36,18,6,4,2,0],'base':[120,60,36,18,12,6,3],'high':[120,84,59,30,20,10,5]}.items():
        for i,(stage,n) in enumerate(zip(stages,counts)):
            rows.append(dict(scenario=scenario,funnel='restaurant_account',stage=stage,unit='deduplicated_restaurant_account',planned_count=n,previous_count=counts[i-1] if i else '',conversion_from_previous=round(n/counts[i-1],6) if i else '',evidence_status='hypothesis_not_observed',note='Scoping is not an onsite visit; paid assessment is not SaaS or physical pilot'))
    for i,(stage,n) in enumerate(zip(['viewed','started','meaningful_completed'],[600,300,180])):
        prev=[600,300,180][i-1] if i else ''
        rows.append(dict(scenario='base',funnel='content_viewer',stage=stage,unit='unique_person_if_measurable_else_report_sessions',planned_count=n,previous_count=prev,conversion_from_previous=round(n/prev,6) if prev else '',evidence_status='hypothesis_not_observed',note='Separate funnel; do not multiply into restaurant-account funnel without identity evidence'))
    rows.append(dict(scenario='base',funnel='partner',stage='meeting_held',unit='partner_meeting',planned_count=3,previous_count='',conversion_from_previous='',evidence_status='hypothesis_not_observed',note='Additional to 12 restaurant meetings; not an account-funnel conversion'))
    write('funnel.csv',list(rows[0]),rows)
    rows=[]
    for name,period,rev,cost,note in [
      ('workflow_assessment','one_time',8000000,5000000,'10h x400k plus1m direct costs; proposed fee not approved'),
      ('software_integration','one_time',30000000,21000000,'45h x400k plus3m direct costs; scope-specific example'),
      ('saas_serve','monthly_per_site',2000000,600000,'cloud200k plus application_support400k; excludes hardware and onsite support'),
      ('hardware_resale_illustration','one_time',120000000,108000000,'ARBITRARY FINANCIAL EXAMPLE NOT A ROBOT QUOTE; landed95m install5m warranty8m'),
      ('hardware_maintenance_illustration','monthly_per_site',1500000,1200000,'Separate hardware support; do not double-count SaaS support')]:
        rows.append(dict(item=name,period=period,revenue_vnd=rev,direct_cost_vnd=cost,gross_profit_vnd=rev-cost,gross_margin=(rev-cost)/rev,assumed_cac_vnd='',payback_months='',status='hypothesis_not_observed',note=note))
    for name,price,cost,cac in [('base',2000000,600000,12000000),('price_low',1000000,600000,12000000),('price_high',3000000,600000,12000000),('support_high',2000000,1200000,12000000),('cac_high',2000000,600000,24000000)]:
        rows.append(dict(item='payback_'+name,period='monthly_per_site',revenue_vnd=price,direct_cost_vnd=cost,gross_profit_vnd=price-cost,gross_margin=(price-cost)/price,assumed_cac_vnd=cac,payback_months=round(cac/(price-cost),6),status='hypothesis_not_observed',note='Prospective SaaS only; no observed CAC or churn/LTV; excludes service/hardware GP'))
    write('economics.csv',list(rows[0]),rows)

def validate():
    with (ROOT/'budget.csv').open(encoding='utf-8-sig') as f: rows=list(csv.DictReader(f))
    for scenario,cash,labor in [('lean',24000000,50400000),('standard',60000000,78000000),('partner_intensive',120000000,108000000)]:
        selected=[r for r in rows if r['scenario']==scenario]
        assert sum(int(r['total_vnd']) for r in selected if r['cost_type']=='cash_ceiling')==cash
        assert sum(int(r['total_vnd']) for r in selected if r['cost_type']=='imputed_labor')==labor
        for r in selected: assert int(r['quantity'])*int(r['unit_cost_vnd'])==int(r['total_vnd'])
        print(f'{scenario}: cash {cash:,}; labor {labor:,}; total {cash+labor:,} VND')
    with (ROOT/'funnel.csv').open(encoding='utf-8-sig') as f: rows=list(csv.DictReader(f))
    for r in rows:
        if r['previous_count']:
            ratio=int(r['planned_count'])/int(r['previous_count'])
            assert abs(ratio-float(r['conversion_from_previous']))<0.000001
    base=[int(r['planned_count']) for r in rows if r['scenario']=='base' and r['funnel']=='restaurant_account']
    assert base==[120,60,36,18,12,6,3]
    with (ROOT/'economics.csv').open(encoding='utf-8-sig') as f: rows=list(csv.DictReader(f))
    for r in rows:
        revenue,cost,gp=(int(r[k]) for k in ['revenue_vnd','direct_cost_vnd','gross_profit_vnd'])
        assert revenue-cost==gp
        assert abs(gp/revenue-float(r['gross_margin']))<0.000001
        if r['assumed_cac_vnd']: assert abs(int(r['assumed_cac_vnd'])/gp-float(r['payback_months']))<0.000001
    print('PASS: CSV totals, conversion arithmetic, gross margins and prospective payback.')

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rebuild',action='store_true',help='Regenerate the three planning CSV files from canonical assumptions')
    args=parser.parse_args()
    if args.rebuild: build()
    validate()
